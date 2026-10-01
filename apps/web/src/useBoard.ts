import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  BoardClient,
  IndexedDbStore,
  MemoryStore,
  type BoardView,
  type LocalStore,
  type Rejection,
  type Status,
} from "@kanban/client";
import type { Role } from "@kanban/shared";

const EMPTY_VIEW: BoardView = { board: { columns: {}, cards: {} }, pending: new Set() };

function serverUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}`; // Vite proxies /boards to the Node server
}

/** One IndexedDB connection per tab. Falls back to memory where IndexedDB is unavailable. */
const store: LocalStore = typeof indexedDB === "undefined" ? new MemoryStore() : new IndexedDbStore();

/** One BoardClient per mounted board. */
export function useBoard(boardId: string, role: Role) {
  const [client, setClient] = useState<BoardClient | null>(null);
  const [status, setStatus] = useState<Status>("offline");
  /** False until this device's saved copy of the board has been read (so F9 doesn't flash). */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const next = new BoardClient({ url: serverUrl(), boardId, role, store });
    const stopStatus = next.onStatus(setStatus);
    let alive = true;
    void next.ready.then(() => alive && setLoaded(true));
    next.connect();
    // The effect creates the client (it owns a socket, so it can't be created during render),
    // and the render needs it: storing it in state is the point. Runs once per board.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClient(next);
    return () => {
      alive = false;
      setLoaded(false);
      stopStatus();
      next.destroy();
    };
  }, [boardId, role]);

  const subscribe = useCallback(
    (listener: () => void) => client?.subscribe(listener) ?? (() => {}),
    [client],
  );
  const view = useSyncExternalStore(subscribe, () => client?.getView() ?? EMPTY_VIEW);

  return { client, status, view, loaded };
}

/** Ids that should briefly glow, and why. */
export type Highlight = "rolled-back" | "remote";

/**
 * O4: a card whose change was rejected flashes as it returns.
 * C4: a card moved by someone else gets a brief highlight instead of a notification.
 */
export function useHighlights(client: BoardClient | null): ReadonlyMap<string, Highlight> {
  const [highlights, setHighlights] = useState<ReadonlyMap<string, Highlight>>(new Map());

  const flash = useCallback((ids: string[], kind: Highlight) => {
    if (ids.length === 0) return;
    setHighlights((current) => new Map([...current, ...ids.map((id) => [id, kind] as const)]));
    setTimeout(() => {
      setHighlights((current) => {
        const next = new Map(current);
        for (const id of ids) if (next.get(id) === kind) next.delete(id);
        return next;
      });
    }, 1200);
  }, []);

  useEffect(
    () =>
      client?.onRejected((r: Rejection) =>
        flash(["cardId" in r.intent.args ? r.intent.args.cardId : r.intent.args.columnId], "rolled-back"),
      ),
    [client, flash],
  );

  // Compare each new view with the one before it, inside the client's own change notification
  // (the recommended way to react to an external store, rather than an effect watching `view`).
  useEffect(() => {
    if (!client) return;
    let before = client.getView();
    return client.subscribe(() => {
      const view = client.getView();
      const moved: string[] = [];
      for (const [id, card] of Object.entries(view.board.cards)) {
        const old = before.board.cards[id];
        if (!old || view.pending.has(id) || before.pending.has(id)) continue; // not someone else's change
        if (old.columnId !== card.columnId || old.order !== card.order) moved.push(id);
      }
      before = view;
      flash(moved, "remote");
    });
  }, [client, flash]);

  return highlights;
}
