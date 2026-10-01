import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import * as Y from "yjs";
import { applyAwarenessUpdate } from "y-protocols/awareness";
import {
  clientMessageSchema,
  fromBase64,
  readBoardState,
  runIntent,
  toBase64,
  writeChanges,
  type ClientMessage,
  type MutationResult,
  type Role,
} from "@kanban/shared";
import { Rooms, SERVER_ORIGIN, type Connection, type Room } from "./room.js";
import { Store } from "./store.js";

export interface ServerOptions {
  port?: number;
  /** SQLite file path, or ":memory:". */
  dbPath: string;
  /** Enables the dev panel messages (O8). Never on in production. */
  dev?: boolean;
}

export interface RunningServer {
  port: number;
  rooms: Rooms;
  close(): Promise<void>;
}

const BOARD_PATH = /^\/boards\/([\w-]{1,64})$/;

/**
 * `ws` hands a message over as a Buffer, an ArrayBuffer, or a Buffer[] (a fragmented message).
 * `String(arrayBuffer)` would give "[object ArrayBuffer]", so decode each shape explicitly.
 */
function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return (Buffer.isBuffer(data) ? data : Buffer.from(data)).toString("utf8");
}

export async function createServer({ port = 0, dbPath, dev = false }: ServerOptions): Promise<RunningServer> {
  const store = new Store(dbPath);
  const rooms = new Rooms(store);
  const http = createHttpServer((_req, res) => {
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true });

  // ws://host/boards/<boardId>?role=editor|viewer
  // Auth is out of scope (§12): the role is simply chosen by the client.
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = BOARD_PATH.exec(url.pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const role: Role = url.searchParams.get("role") === "viewer" ? "viewer" : "editor";
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, match[1]!, role));
  });

  /**
   * Heartbeat. A tab whose network died never sends "close"; without pings the server would keep
   * it (and its cursor) until the OS gives up on the TCP connection, which can take minutes.
   */
  const alive = new WeakMap<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate(); // fires "close", which removes its presence
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 10_000);

  function onConnection(ws: WebSocket, boardId: string, role: Role) {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    const conn: Connection = {
      role,
      awarenessIds: new Set(),
      send: (message) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
    };
    const room = rooms.join(boardId, conn);

    conn.send({ t: "welcome", role });
    // Ask the client for anything we lack, e.g. edits made while it was offline (F4).
    conn.send({ t: "sync1", doc: "content", sv: toBase64(Y.encodeStateVector(room.content)) });
    const presence = room.presenceSnapshot();
    if (presence) conn.send(presence);

    ws.on("message", (data) => {
      let message: ClientMessage;
      try {
        message = clientMessageSchema.parse(JSON.parse(textOf(data)));
      } catch {
        conn.send({ t: "error", code: "BAD_MESSAGE" });
        return;
      }
      try {
        handle(room, conn, message);
      } catch {
        // Valid JSON but a corrupt Yjs/awareness payload. Throwing here would crash the process.
        conn.send({ t: "error", code: "BAD_MESSAGE" });
      }
    });
    ws.on("close", () => rooms.leave(room, conn));
  }

  function handle(room: Room, conn: Connection, message: ClientMessage) {
    switch (message.t) {
      case "sync1": {
        const doc = room.doc(message.doc);
        const missing = Y.encodeStateAsUpdate(doc, fromBase64(message.sv));
        conn.send({ t: "sync2", doc: message.doc, update: toBase64(missing) });
        return;
      }
      case "sync2":
      case "update": {
        if (conn.role !== "editor") {
          // R1: dropped, never applied or broadcast.
          conn.send({ t: "error", code: "FORBIDDEN", message: "viewers can't edit" });
          return;
        }
        // origin = conn, so Room.relay sends it to everyone except the sender.
        Y.applyUpdate(room.content, fromBase64(message.update), conn);
        return;
      }
      case "intent":
        handleIntent(room, conn, message);
        return;
      case "awareness":
        // Viewers may share presence too: it isn't editing.
        // Not verified: a client could send states for ids it doesn't own. Fine without auth (§12).
        applyAwarenessUpdate(room.awareness, fromBase64(message.update), conn);
        return;
      case "dev":
        if (dev) room.dev[message.action] = true;
        return;
    }
  }

  /**
   * The server's half of an optimistic update (D3/D4):
   * 1. Already decided this id? Answer the same way again and change nothing (R8).
   * 2. Run the same mutator the client ran, against the real state.
   * 3. Accepted: write the structure doc. Room.relay broadcasts that update to *everyone*,
   *    the sender included (origin is the server, not the connection).
   * 4. Only then ack. The sender therefore always has the new state before it drops the intent
   *    from its outbox, so nothing flickers (O3).
   */
  function handleIntent(room: Room, conn: Connection, message: Extract<ClientMessage, { t: "intent" }>) {
    const { id, name, args } = message;
    const store = room.store;

    const previous = store.intentResult(room.id, id);
    if (previous) {
      reply(
        room,
        conn,
        id,
        previous.code === null ? { ok: true, changes: [] } : { ok: false, code: previous.code },
      );
      return;
    }

    let result: MutationResult;
    if (room.dev.rejectNext) {
      room.dev.rejectNext = false;
      result = { ok: false, code: "DEV_REJECT" };
    } else {
      // Reading the whole structure doc per intent is O(board size). Fine at this scale;
      // a bigger app would keep a cached BoardState next to the doc.
      result = runIntent(readBoardState(room.structure), { name, args }, { role: conn.role });
    }

    // One SQLite transaction: the update rows and the intent record are committed together.
    store.transaction(() => {
      if (result.ok && result.changes.length > 0) writeChanges(room.structure, result.changes, SERVER_ORIGIN);
      store.recordIntent(room.id, id, result.ok ? null : result.code);
    });
    reply(room, conn, id, result);
  }

  function reply(room: Room, conn: Connection, id: string, result: MutationResult) {
    if (room.dev.dropNextReply) {
      // Simulates a lost ack/nack so the client's resend timer (O7) can be tested.
      room.dev.dropNextReply = false;
      return;
    }
    if (result.ok) conn.send({ t: "ack", id });
    else
      conn.send(
        result.message
          ? { t: "nack", id, code: result.code, message: result.message }
          : { t: "nack", id, code: result.code },
      );
  }

  await new Promise<void>((resolve) => http.listen(port, resolve));

  return {
    port: (http.address() as AddressInfo).port,
    rooms,
    close: async () => {
      clearInterval(heartbeat);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      store.close();
    },
  };
}
