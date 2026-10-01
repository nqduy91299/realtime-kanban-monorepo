import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import {
  applyChanges,
  fromBase64,
  intentTarget,
  parsePresence,
  readBoardState,
  runIntent,
  toBase64,
  type BoardState,
  type ClientMessage,
  type Intent,
  type IntentArgs,
  type IntentName,
  type Peer,
  type Presence,
  type RejectCode,
  type Role,
  type ServerErrorCode,
  type ServerMessage,
} from "@kanban/shared";
import type { LocalStore } from "./localStore.js";

/**
 * connecting: socket opening · syncing: open, handshake not finished
 * online: both docs in sync · offline: no socket (reconnect scheduled unless disconnect() was called)
 */
export type Status = "connecting" | "syncing" | "online" | "offline";

export interface BoardClientOptions {
  /** Server origin, e.g. "ws://localhost:4000". */
  url: string;
  boardId: string;
  role?: Role;
  /** Defaults to true. Tests turn it off to control connections by hand. */
  reconnect?: boolean;
  /** Resend an intent that got no ack/nack within this time (O7). Default 10 s. */
  ackTimeoutMs?: number;
  /** Keeps both docs and the outbox on this device, so a reload while offline loses nothing (F3). */
  store?: LocalStore;
  /**
   * React to the browser's online/offline events (F1): drop the socket as soon as the network
   * goes away, reconnect the moment it's back. Defaults to true in a browser.
   */
  watchNetwork?: boolean;
}

/** What the UI renders: confirmed state + replay(outbox) (D3). */
export interface BoardView {
  board: BoardState;
  /** Ids of cards/columns with an intent still waiting for the server (O2). */
  pending: ReadonlySet<string>;
}

export interface Rejection {
  intent: Intent;
  code: RejectCode;
  message?: string;
}

export type MutateResult = { ok: true; id: string } | { ok: false; code: RejectCode };

/** Who asked for a change. Undo history records only "user" changes (M6). */
export type MutationSource = "user" | "undo" | "redo";

export type MutationListener = (intent: Intent, before: BoardState, source: MutationSource) => void;

/** Marks updates that came from the server, so we don't echo them back. */
const REMOTE = Symbol("remote");
/** Marks updates loaded from this device's storage: neither sent nor saved again. */
const STORAGE = Symbol("storage");

/**
 * Keeps a board in sync with the server.
 *
 * Text (`content` doc): a CRDT. Local edits go straight into the doc and are sent as Yjs updates.
 * Offline edits need no extra code: on reconnect the server sends sync1 and we reply with
 * whatever it's missing.
 *
 * Structure (`structure` doc): only the server writes it. Local changes are *intents* kept in an
 * outbox; the UI shows `view = confirmed + replay(outbox)`. An ack removes the intent (its effect
 * is already in `confirmed`); a nack removes it too, and the recomputed view is the rollback.
 */
export class BoardClient {
  readonly content = new Y.Doc();
  readonly structure = new Y.Doc();
  /** Presence (D6). Our own state plus everyone else's, as last heard from the server. */
  readonly awareness: Awareness;
  /** Resolves once anything saved on this device has been loaded (immediately without a store). */
  readonly ready: Promise<void>;

  status: Status = "offline";
  role: Role;

  private ws: WebSocket | null = null;
  private stopped = true;
  private destroyed = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSync = new Set<"content" | "structure">();

  private outbox: Intent[] = [];
  private ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private confirmed: BoardState;
  private view: BoardView;

  /** Dev panel (O8): extra one-way delay applied to every message, in both directions. */
  private latencyMs = 0;
  private lastSendAt = 0;
  private lastReceiveAt = 0;

  private statusListeners = new Set<(status: Status) => void>();
  private errorListeners = new Set<(code: ServerErrorCode, message?: string) => void>();
  private viewListeners = new Set<() => void>();
  private rejectionListeners = new Set<(rejection: Rejection) => void>();
  private mutationListeners = new Set<MutationListener>();
  private peers: Peer[] = [];
  private syncedWaiters: (() => void)[] = [];

  constructor(private options: BoardClientOptions) {
    this.role = options.role ?? "editor";
    this.confirmed = readBoardState(this.structure);
    this.view = { board: this.confirmed, pending: new Set() };
    this.content.on("update", this.onLocalContentUpdate);
    this.structure.on("update", this.onStructureUpdate);
    this.awareness = new Awareness(this.content);
    this.awareness.setLocalState(null); // nothing to share until setPresence()
    this.awareness.on("update", this.onLocalAwarenessUpdate);
    this.awareness.on("change", this.onAwarenessChange);

    if (options.store) {
      this.content.on("update", this.saveContent);
      this.structure.on("update", this.saveStructure);
    }
    this.ready = this.loadLocal();

    if (options.watchNetwork ?? typeof window !== "undefined") {
      window.addEventListener("offline", this.onBrowserOffline);
      window.addEventListener("online", this.onBrowserOnline);
    }
  }

  /** Connects after local data has loaded, so what we send on connect includes it. */
  connect(): void {
    this.stopped = false;
    void this.ready.then(() => {
      if (!this.stopped && !this.ws) this.open();
    });
  }

  /**
   * True once we have the board at all, from the server or from this device. A board that was
   * never opened online has nothing to show offline (F9).
   */
  get hasData(): boolean {
    return Object.keys(this.confirmed.columns).length > 0;
  }

  /** Close the socket and stay offline until connect() is called again. */
  disconnect(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.forgetPeers();
    this.setStatus("offline");
  }

  destroy(): void {
    this.destroyed = true;
    if (this.options.watchNetwork ?? typeof window !== "undefined") {
      window.removeEventListener("offline", this.onBrowserOffline);
      window.removeEventListener("online", this.onBrowserOnline);
    }
    // Tell the others we're gone now, rather than letting them wait for the 30 s timeout (P5).
    removeAwarenessStates(this.awareness, [this.awareness.clientID], "local");
    this.disconnect();
    this.awareness.destroy();
    for (const timer of this.ackTimers.values()) clearTimeout(timer);
    this.content.off("update", this.onLocalContentUpdate);
    this.structure.off("update", this.onStructureUpdate);
    this.content.off("update", this.saveContent);
    this.structure.off("update", this.saveStructure);
    this.content.destroy();
    this.structure.destroy();
  }

  whenSynced(): Promise<void> {
    if (this.status === "online") return Promise.resolve();
    return new Promise((resolve) => this.syncedWaiters.push(resolve));
  }

  /* ---------- structure: intents and the optimistic view ---------- */

  /**
   * Ask for a structure change. It shows up in the view immediately (O1).
   * If the change is already invalid against what we see locally, nothing is queued and the
   * reason comes back right away. Most rejections never need a round trip.
   */
  mutate<N extends IntentName>(name: N, args: IntentArgs<N>, source: MutationSource = "user"): MutateResult {
    const body = { name, args } as Extract<Intent, { name: N }>;
    const before = this.view.board;
    const local = runIntent(before, body, { role: this.role });
    if (!local.ok) return { ok: false, code: local.code };

    const intent = { ...body, id: newIntentId() } as Intent;
    for (const listener of this.mutationListeners) listener(intent, before, source);
    this.outbox.push(intent);
    this.options.store?.addIntent(this.options.boardId, intent);
    this.recomputeView();
    this.sendIntent(intent);
    return { ok: true, id: intent.id };
  }

  getView(): BoardView {
    return this.view;
  }

  /** Pending intents, oldest first. */
  getOutbox(): readonly Intent[] {
    return this.outbox;
  }

  /** For React's useSyncExternalStore: called whenever getView() returns a new object. */
  subscribe(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  /** Every change accepted locally, with the board as it was just before it. */
  onMutate(listener: MutationListener): () => void {
    this.mutationListeners.add(listener);
    return () => this.mutationListeners.delete(listener);
  }

  onRejected(listener: (rejection: Rejection) => void): () => void {
    this.rejectionListeners.add(listener);
    return () => this.rejectionListeners.delete(listener);
  }

  private onStructureUpdate = (): void => {
    this.confirmed = readBoardState(this.structure);
    this.recomputeView(); // rebase: pending intents replayed on the new confirmed state (O6)
  };

  /**
   * D3. Intents that fail during replay (e.g. someone else filled the column meanwhile) are
   * simply skipped, so the view already shows what the server is about to say.
   */
  private recomputeView(): void {
    let board = this.confirmed;
    const pending = new Set<string>();
    for (const intent of this.outbox) {
      pending.add(intentTarget(intent));
      const result = runIntent(board, intent, { role: this.role });
      if (result.ok) board = applyChanges(board, result.changes);
    }
    this.view = { board, pending };
    for (const listener of this.viewListeners) listener();
  }

  private sendIntent(intent: Intent): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return; // sent on reconnect instead
    this.send({ t: "intent", id: intent.id, name: intent.name, args: intent.args });
    // O7: no answer in time → send the same id again. Safe because the server dedupes ids (R8).
    clearTimeout(this.ackTimers.get(intent.id));
    this.ackTimers.set(
      intent.id,
      setTimeout(() => {
        if (this.outbox.includes(intent)) this.sendIntent(intent);
      }, this.options.ackTimeoutMs ?? 10_000),
    );
  }

  private settle(id: string, rejection?: { code: RejectCode; message?: string }): void {
    clearTimeout(this.ackTimers.get(id));
    this.ackTimers.delete(id);
    const intent = this.outbox.find((i) => i.id === id);
    if (!intent) return; // a duplicate answer to a resend
    this.outbox = this.outbox.filter((i) => i !== intent);
    this.options.store?.removeIntent(this.options.boardId, id);
    this.recomputeView();
    if (rejection) {
      for (const listener of this.rejectionListeners) listener({ intent, ...rejection });
    }
  }

  /* ---------- this device's storage (F2, F3) ---------- */

  private async loadLocal(): Promise<void> {
    const { store, boardId } = this.options;
    if (!store) return;
    try {
      const saved = await store.load(boardId);
      if (this.destroyed) return;
      if (saved.structure) Y.applyUpdate(this.structure, saved.structure, STORAGE);
      if (saved.content) Y.applyUpdate(this.content, saved.content, STORAGE);
      // Saved intents are older than anything mutate()d while loading, so they go first (F5).
      const fresh = this.outbox.filter((i) => !saved.outbox.some((s) => s.id === i.id));
      this.outbox = [...saved.outbox, ...fresh];
      this.recomputeView();
    } catch (error) {
      console.warn("kanban: couldn't load local data", error);
    }
  }

  // Both docs are saved, server updates included, so a reload offline shows the latest board we saw.
  private saveContent = (update: Uint8Array, origin: unknown): void => {
    if (origin !== STORAGE) this.options.store!.appendUpdate(this.options.boardId, "content", update);
  };
  private saveStructure = (update: Uint8Array, origin: unknown): void => {
    if (origin !== STORAGE) this.options.store!.appendUpdate(this.options.boardId, "structure", update);
  };

  /* ---------- browser network events (F1) ---------- */

  /**
   * When the network disappears, a WebSocket often doesn't notice for a long time (no packets
   * arrive, but none fail either). The browser knows sooner, so we drop the socket right away.
   */
  private onBrowserOffline = (): void => {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = ws.onmessage = null;
    ws.close();
    this.forgetPeers();
    this.setStatus("offline");
    if (!this.stopped && this.options.reconnect !== false) this.scheduleReconnect();
  };

  private onBrowserOnline = (): void => {
    if (this.stopped || this.ws) return;
    clearTimeout(this.retryTimer);
    this.retries = 0;
    this.open(); // now, not after the backoff delay
  };

  /* ---------- presence (P1–P8) ---------- */

  /** Update some fields of our presence, e.g. `{ cursor: null }`. The first call must include `user`. */
  setPresence(fields: Partial<Presence>): void {
    const current = (this.awareness.getLocalState() as Presence | null) ?? {
      user: { name: "Anonymous", color: "#868e96" },
      cursor: null,
      focus: null,
      dragging: null,
    };
    this.awareness.setLocalState({ ...current, ...fields });
  }

  /** Everyone else on the board, one entry per tab (P7). Stable until presence changes. */
  getPeers(): readonly Peer[] {
    return this.peers;
  }

  onPresence(listener: () => void): () => void {
    this.awareness.on("change", listener);
    return () => this.awareness.off("change", listener);
  }

  private onAwarenessChange = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    // Our own cursor moving shouldn't produce a new peers array (and a React re-render).
    if ([...added, ...updated, ...removed].every((id) => id === this.awareness.clientID)) return;
    const peers: Peer[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) continue;
      const presence = parsePresence(state);
      if (presence) peers.push({ clientId, ...presence });
    }
    this.peers = peers.sort((a, b) => a.clientId - b.clientId);
  };

  private onLocalAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === REMOTE) return;
    // Offline: dropped (P8). On reconnect we send our current state anyway.
    this.send({
      t: "awareness",
      update: toBase64(encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed])),
    });
  };

  /**
   * Offline: forget everyone else (P8). Also forget their clocks. Awareness ignores a state
   * whose clock isn't newer than the last one it saw, so without this, the states the server
   * sends on reconnect would be ignored until each peer's next renewal (up to 15 s).
   */
  private forgetPeers(): void {
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.awareness.clientID);
    removeAwarenessStates(this.awareness, others, REMOTE);
    for (const id of others) this.awareness.meta.delete(id);
  }

  /* ---------- dev panel (O8) ---------- */

  setLatency(ms: number): void {
    this.latencyMs = Math.max(0, ms);
  }

  /** Server rejects the next intent it receives on this board (dev mode only). */
  devRejectNext(): void {
    this.send({ t: "dev", action: "rejectNext" });
  }

  /** Server drops its next ack/nack on this board, to exercise the resend timer (dev mode only). */
  devDropNextReply(): void {
    this.send({ t: "dev", action: "dropNextReply" });
  }

  /* ---------- listeners ---------- */

  onStatus(listener: (status: Status) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onError(listener: (code: ServerErrorCode, message?: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /* ---------- connection ---------- */

  private open(): void {
    const { url, boardId } = this.options;
    const ws = new WebSocket(`${url}/boards/${encodeURIComponent(boardId)}?role=${this.role}`);
    this.ws = ws;
    this.setStatus("connecting");

    ws.onopen = () => {
      this.retries = 0;
      this.pendingSync = new Set(["content", "structure"]);
      this.setStatus("syncing");
      this.send({ t: "sync1", doc: "structure", sv: toBase64(Y.encodeStateVector(this.structure)) });
      this.send({ t: "sync1", doc: "content", sv: toBase64(Y.encodeStateVector(this.content)) });
      // Everything still pending, in its original order (F5). The server processes a
      // connection's messages in order, and already-decided ids are answered, not re-applied (R8).
      for (const intent of this.outbox) this.sendIntent(intent);
      // Re-announce ourselves with a bumped clock. The server removed our state when the old
      // connection closed, and it would ignore a state with the same clock it already has.
      const presence = this.awareness.getLocalState();
      if (presence) this.awareness.setLocalState(presence);
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.delayed("receive", () => {
        if (this.ws === ws) this.receive(message);
      });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // an old socket we already replaced
      this.ws = null;
      this.forgetPeers();
      this.setStatus("offline");
      if (!this.stopped && this.options.reconnect !== false) this.scheduleReconnect();
    };
  }

  /** Exponential backoff with jitter: 250 ms, 500 ms, 1 s … capped at 5 s. */
  private scheduleReconnect(): void {
    const delay = Math.min(5000, 250 * 2 ** this.retries) * (0.5 + Math.random() / 2);
    this.retries++;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private send(message: ClientMessage): void {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    this.delayed("send", () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    });
  }

  /**
   * Simulated network delay that keeps messages in order: each one is scheduled no earlier than
   * the previous one in the same direction, even if the latency slider moves in between.
   */
  private delayed(direction: "send" | "receive", fn: () => void): void {
    if (this.latencyMs === 0 && this.lastDue(direction) <= Date.now()) {
      fn();
      return;
    }
    const due = Math.max(Date.now() + this.latencyMs, this.lastDue(direction));
    if (direction === "send") this.lastSendAt = due;
    else this.lastReceiveAt = due;
    setTimeout(fn, due - Date.now());
  }

  private lastDue(direction: "send" | "receive"): number {
    return direction === "send" ? this.lastSendAt : this.lastReceiveAt;
  }

  /* ---------- messages ---------- */

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case "welcome":
        this.role = message.role;
        return;
      case "sync1": {
        const missing = Y.encodeStateAsUpdate(this.content, fromBase64(message.sv));
        if (this.role === "editor") this.send({ t: "sync2", doc: "content", update: toBase64(missing) });
        return;
      }
      case "sync2":
        Y.applyUpdate(this.docFor(message.doc), fromBase64(message.update), REMOTE);
        this.pendingSync.delete(message.doc);
        if (this.pendingSync.size === 0) this.setStatus("online");
        return;
      case "update":
        Y.applyUpdate(this.docFor(message.doc), fromBase64(message.update), REMOTE);
        return;
      case "awareness":
        applyAwarenessUpdate(this.awareness, fromBase64(message.update), REMOTE);
        return;
      case "ack":
        this.settle(message.id);
        return;
      case "nack":
        this.settle(
          message.id,
          message.message === undefined
            ? { code: message.code }
            : { code: message.code, message: message.message },
        );
        return;
      case "error":
        for (const listener of this.errorListeners) listener(message.code, message.message);
        return;
    }
  }

  private onLocalContentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE || origin === STORAGE) return;
    // Viewers can't edit (R1); the UI disables inputs, and the server would drop it anyway.
    if (this.role !== "editor") return;
    // While offline this is a no-op; the edit stays in `content` and goes out via sync on reconnect.
    this.send({ t: "update", doc: "content", update: toBase64(update) });
  };

  private docFor(name: "content" | "structure"): Y.Doc {
    return name === "content" ? this.content : this.structure;
  }

  private setStatus(status: Status): void {
    if (status === this.status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
    if (status === "online") {
      const waiters = this.syncedWaiters;
      this.syncedWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }
}

function newIntentId(): string {
  return crypto.randomUUID();
}
