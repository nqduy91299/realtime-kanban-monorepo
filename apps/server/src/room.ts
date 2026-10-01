import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { seedBoard, toBase64, type DocName, type Role, type ServerMessage } from "@kanban/shared";
import type { Store } from "./store.js";

export interface Connection {
  role: Role;
  send(message: ServerMessage): void;
  /** Awareness client ids this connection has announced, removed when it closes (P5). */
  awarenessIds: Set<number>;
}

/** Origin for changes the server makes itself (seeding now, intents in M2). */
export const SERVER_ORIGIN = Symbol("server");

/**
 * One board = one room (S6). The room owns the board's two docs while at least one
 * client is connected, persists every update, and relays it to everyone else.
 */
export class Room {
  readonly content = new Y.Doc();
  readonly structure = new Y.Doc();
  readonly connections = new Set<Connection>();
  /**
   * Presence of everyone on the board (D6). Held in memory only, never written to the store (P6).
   * Its built-in timer drops anyone who hasn't renewed their state for 30 s (P5).
   */
  readonly awareness: Awareness;
  /** Dev panel switches (O8), per board. Only honoured when the server runs in dev mode. */
  readonly dev = { rejectNext: false, dropNextReply: false };

  constructor(
    readonly id: string,
    readonly store: Store,
  ) {
    const existed = store.load(id, "structure", this.structure);
    store.load(id, "content", this.content);

    this.relay("content", this.content);
    this.relay("structure", this.structure);

    this.awareness = new Awareness(this.content);
    this.awareness.setLocalState(null); // the server itself has no presence
    this.awareness.on("update", this.relayAwareness);

    if (!existed) seedBoard(this.structure, this.content, SERVER_ORIGIN);
  }

  /**
   * Every update, from a client or from the server itself: persist it, then send it to
   * every connection except the one it came from (`origin` is the sending Connection).
   */
  private relay(name: DocName, doc: Y.Doc): void {
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.store.append(this.id, name, update);
      const message: ServerMessage = { t: "update", doc: name, update: toBase64(update) };
      for (const conn of this.connections) {
        if (conn !== origin) conn.send(message);
      }
    });
  }

  /** Send presence changes to everyone except the connection they came from. */
  private relayAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const changed = [...added, ...updated, ...removed];
    const from = this.connections.has(origin as Connection) ? (origin as Connection) : null;
    if (from) {
      for (const id of [...added, ...updated]) from.awarenessIds.add(id);
      for (const id of removed) from.awarenessIds.delete(id);
    }
    const message: ServerMessage = { t: "awareness", update: toBase64(encodeAwarenessUpdate(this.awareness, changed)) };
    for (const conn of this.connections) {
      if (conn !== from) conn.send(message);
    }
  };

  /** Everyone currently present, for a client that just joined. */
  presenceSnapshot(): ServerMessage | null {
    const ids = [...this.awareness.getStates().keys()];
    if (ids.length === 0) return null;
    return { t: "awareness", update: toBase64(encodeAwarenessUpdate(this.awareness, ids)) };
  }

  /** A closed tab disappears for everyone right away, not after the 30 s timeout (P5). */
  forgetPresence(conn: Connection): void {
    removeAwarenessStates(this.awareness, [...conn.awarenessIds], null);
  }

  doc(name: DocName): Y.Doc {
    return name === "content" ? this.content : this.structure;
  }

  destroy(): void {
    this.awareness.destroy();
    this.content.destroy();
    this.structure.destroy();
  }
}

export class Rooms {
  private rooms = new Map<string, Room>();

  constructor(private store: Store) {}

  join(boardId: string, conn: Connection): Room {
    let room = this.rooms.get(boardId);
    if (!room) {
      room = new Room(boardId, this.store);
      this.rooms.set(boardId, room);
    }
    room.connections.add(conn);
    return room;
  }

  /** Every update is already on disk, so an empty room can simply be dropped from memory. */
  leave(room: Room, conn: Connection): void {
    room.connections.delete(conn);
    room.forgetPresence(conn);
    if (room.connections.size === 0) {
      room.destroy();
      this.rooms.delete(room.id);
    }
  }

  get(boardId: string): Room | undefined {
    return this.rooms.get(boardId);
  }

  get size(): number {
    return this.rooms.size;
  }
}
