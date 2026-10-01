import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getText, readBoardState, sortedColumnIds, textKey } from "@kanban/shared";
import { connect, eventually, startServer } from "./helpers.js";

const title = (client: { content: Y.Doc }, columnId = "todo") =>
  getText(client.content, textKey.columnTitle(columnId));

describe("S1 two clients see the same board", () => {
  it("a new board is seeded, and both clients receive identical docs", async () => {
    const server = await startServer();
    const alice = await connect(server);
    const bob = await connect(server);

    expect(sortedColumnIds(readBoardState(alice.structure))).toEqual(["todo", "doing", "done"]);
    expect(title(alice).toString()).toBe("To do");
    expect(Y.encodeStateAsUpdate(bob.structure)).toEqual(Y.encodeStateAsUpdate(alice.structure));
    expect(Y.encodeStateAsUpdate(bob.content)).toEqual(Y.encodeStateAsUpdate(alice.content));
  });
});

describe("S2 changes arrive quickly", () => {
  it("an edit reaches the other client in < 200 ms (p95 over 50 edits)", async () => {
    const server = await startServer();
    const alice = await connect(server);
    const bob = await connect(server);

    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const started = performance.now();
      title(alice).insert(0, "x");
      await eventually(() => expect(title(bob).length).toBe(title(alice).length));
      latencies.push(performance.now() - started);
    }
    latencies.sort((a, b) => a - b);
    expect(latencies[Math.floor(latencies.length * 0.95)]).toBeLessThan(200);
  });
});

describe("C1 concurrent text edits through the server", () => {
  it("both edits survive", async () => {
    const server = await startServer();
    const alice = await connect(server);
    const bob = await connect(server);
    title(alice).delete(0, title(alice).length);
    title(alice).insert(0, "Fix bug");
    await eventually(() => expect(title(bob).toString()).toBe("Fix bug"));

    // Take Bob offline so the edits are truly concurrent, not just fast.
    bob.disconnect();
    title(alice).insert(7, " now");
    title(bob).insert(0, "Urgent: ");
    bob.connect();

    await eventually(() => {
      expect(title(alice).toString()).toBe("Urgent: Fix bug now");
      expect(title(bob).toString()).toBe("Urgent: Fix bug now");
    });
  });
});

describe("S4 a late joiner", () => {
  it("gets the full history as one snapshot, then live updates", async () => {
    const server = await startServer();
    const alice = await connect(server);
    for (let i = 0; i < 20; i++) title(alice).insert(title(alice).length, `${i}`);
    await eventually(() => expect(server.rooms.size).toBe(1));

    const carol = await connect(server); // resolves after sync2 for both docs
    expect(title(carol).toString()).toBe(title(alice).toString());

    title(alice).insert(0, ">");
    await eventually(() => expect(title(carol).toString()).toBe(title(alice).toString()));
  });
});

describe("S5 persistence", () => {
  it("survives a server restart", async () => {
    const first = await startServer();
    const alice = await connect(first);
    title(alice).insert(0, "Backlog / ");
    // Wait until the server has it (Bob sees it only after the server applied and stored it).
    const bob = await connect(first);
    expect(title(bob).toString()).toBe("Backlog / To do");
    await first.close();

    const second = await startServer(first.dbPath);
    const carol = await connect(second);
    expect(title(carol).toString()).toBe("Backlog / To do");
    // Not seeded twice: still exactly three columns.
    expect(sortedColumnIds(readBoardState(carol.structure))).toEqual(["todo", "doing", "done"]);
  });

  it("frees the room's memory when the last client leaves", async () => {
    const server = await startServer();
    const alice = await connect(server);
    expect(server.rooms.size).toBe(1);
    alice.disconnect();
    await eventually(() => expect(server.rooms.size).toBe(0));
  });
});

describe("S6 rooms are isolated", () => {
  it("an edit on board X never reaches board Y", async () => {
    const server = await startServer();
    const x = await connect(server, "board-x");
    const xPeer = await connect(server, "board-x");
    const y = await connect(server, "board-y");

    let yUpdates = 0;
    y.content.on("update", () => yUpdates++);
    title(x).insert(0, "only on X: ");

    await eventually(() => expect(title(xPeer).toString()).toBe("only on X: To do"));
    expect(yUpdates).toBe(0);
    expect(title(y).toString()).toBe("To do");
  });
});

describe("R1 viewers can't edit text", () => {
  it("a viewer's edit is rejected, never stored or broadcast", async () => {
    const server = await startServer();
    const editor = await connect(server);
    const viewer = await connect(server, "b1", "viewer");

    // A tampered client: bypass the client-side check by sending a raw update over its own socket.
    const errors: string[] = [];
    viewer.onError((code) => errors.push(code));
    const rogue = new Y.Doc();
    Y.applyUpdate(rogue, Y.encodeStateAsUpdate(viewer.content));
    getText(rogue, textKey.columnTitle("todo")).insert(0, "HACKED ");
    const update = Y.encodeStateAsUpdate(rogue, Y.encodeStateVector(viewer.content));
    const ws = new WebSocket(`ws://localhost:${server.port}/boards/b1?role=viewer`);
    await new Promise((r) => (ws.onopen = r));
    const reply = new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.t === "error") resolve(msg.code);
      };
    });
    const { toBase64 } = await import("@kanban/shared");
    ws.send(JSON.stringify({ t: "update", doc: "content", update: toBase64(update) }));
    expect(await reply).toBe("FORBIDDEN");
    ws.close();

    // The editor makes a real edit afterwards; if the rogue one had been relayed, it would show up too.
    title(editor).insert(0, "ok ");
    await eventually(() => expect(title(viewer).toString()).toBe("ok To do"));
    expect(title(editor).toString()).toBe("ok To do");

    // And the normal client refuses to send local edits as a viewer.
    title(viewer).insert(0, "local only ");
    await new Promise((r) => setTimeout(r, 50));
    expect(title(editor).toString()).toBe("ok To do");
    expect(errors).toEqual([]);
  });

  it("rejects malformed messages without crashing", async () => {
    const server = await startServer();
    const ws = new WebSocket(`ws://localhost:${server.port}/boards/b1`);
    await new Promise((r) => (ws.onopen = r));
    const errors: string[] = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.t === "error") errors.push(msg.code);
    };
    ws.send("not json");
    ws.send(JSON.stringify({ t: "update", doc: "structure", update: "AAA=" })); // structure is server-only
    ws.send(JSON.stringify({ t: "update", doc: "content", update: "/////w==" })); // corrupt Yjs bytes
    ws.send(JSON.stringify({ t: "awareness", update: "/////w==" })); // corrupt awareness bytes
    await eventually(() => expect(errors).toEqual(["BAD_MESSAGE", "BAD_MESSAGE", "BAD_MESSAGE", "BAD_MESSAGE"]));
    ws.close();

    const alice = await connect(server); // server still healthy
    expect(title(alice).toString()).toBe("To do");
  });
});
