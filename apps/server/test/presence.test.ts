import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import type { BoardClient } from "@kanban/client";
import { toBase64, type Presence } from "@kanban/shared";
import { connect, eventually, startServer } from "./helpers.js";

const idle = (name: string, color = "#c2255c"): Presence => ({
  user: { name, color },
  cursor: null,
  focus: null,
  dragging: null,
});

const names = (client: BoardClient) =>
  client
    .getPeers()
    .map((p) => p.user.name)
    .sort();

async function twoPeople() {
  const server = await startServer();
  const alice = await connect(server);
  const bob = await connect(server);
  alice.setPresence(idle("Alice"));
  bob.setPresence(idle("Bob", "#1864ab"));
  await eventually(() => {
    expect(names(alice)).toEqual(["Bob"]);
    expect(names(bob)).toEqual(["Alice"]);
  });
  return { server, alice, bob };
}

describe("P1 who's here", () => {
  it("each person sees the others with name and color, never themselves", async () => {
    const { alice } = await twoPeople();
    expect(alice.getPeers()).toMatchObject([{ user: { name: "Bob", color: "#1864ab" } }]);
  });

  it("someone who joins later sees everyone already present", async () => {
    const { server } = await twoPeople();
    const carol = await connect(server);
    await eventually(() => expect(names(carol)).toEqual(["Alice", "Bob"]));
  });

  it("viewers share presence too", async () => {
    const { server, alice } = await twoPeople();
    const viewer = await connect(server, "b1", "viewer");
    viewer.setPresence(idle("Vera"));
    await eventually(() => expect(names(alice)).toEqual(["Bob", "Vera"]));
  });
});

describe("P2 / P3 / P4 cursor, focus, dragging", () => {
  it("each field reaches the others", async () => {
    const { alice, bob } = await twoPeople();
    alice.setPresence({ cursor: { anchor: "todo", x: 0.4, y: 0.25 } });
    await eventually(() => expect(bob.getPeers()[0]?.cursor).toEqual({ anchor: "todo", x: 0.4, y: 0.25 }));

    alice.setPresence({ focus: "card-1" });
    await eventually(() => expect(bob.getPeers()[0]?.focus).toBe("card-1"));

    alice.setPresence({ dragging: "card-1" });
    await eventually(() => expect(bob.getPeers()[0]?.dragging).toBe("card-1"));

    alice.setPresence({ cursor: null, focus: null, dragging: null });
    await eventually(() =>
      expect(bob.getPeers()[0]).toMatchObject({ cursor: null, focus: null, dragging: null }),
    );
  });

  it("ignores presence that doesn't match the schema", async () => {
    const { server, alice } = await twoPeople();
    const rogue = new Awareness(new Y.Doc());
    rogue.setLocalState({ user: { name: "<script>", color: "red; background: url(x)" } });
    const ws = new WebSocket(`ws://localhost:${server.port}/boards/b1`);
    await new Promise((r) => (ws.onopen = r));
    ws.send(
      JSON.stringify({ t: "awareness", update: toBase64(encodeAwarenessUpdate(rogue, [rogue.clientID])) }),
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(names(alice)).toEqual(["Bob"]);
    rogue.destroy();
    ws.close();
  });
});

describe("P5 people who leave disappear", () => {
  it("a closed tab disappears immediately", async () => {
    const { alice, bob } = await twoPeople();
    const started = Date.now();
    bob.destroy();
    await eventually(() => expect(names(alice)).toEqual([]), 500);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("a dropped connection (no clean close from the client) disappears too", async () => {
    const { alice, bob } = await twoPeople();
    bob.disconnect(); // socket closes; the server removes Bob's state on "close"
    await eventually(() => expect(names(alice)).toEqual([]), 500);
  });

  it("someone who stops renewing is dropped after the 30 s timeout", async () => {
    const { server, alice } = await twoPeople();
    // A client that announces itself once and then goes silent without closing its socket.
    const ghost = new Awareness(new Y.Doc());
    ghost.setLocalState(idle("Ghost"));
    const ws = new WebSocket(`ws://localhost:${server.port}/boards/b1`);
    await new Promise((r) => (ws.onopen = r));
    ws.send(
      JSON.stringify({ t: "awareness", update: toBase64(encodeAwarenessUpdate(ghost, [ghost.clientID])) }),
    );
    ghost.destroy(); // stops its renew timer; nothing more will be sent
    await eventually(() => expect(names(alice)).toEqual(["Bob", "Ghost"]));

    // Rather than waiting 30 s, pretend the ghost's last update was 31 s ago.
    // The server's awareness checks every 3 s and should drop it.
    const meta = server.rooms.get("b1")!.awareness.meta.get(ghost.clientID)!;
    meta.lastUpdated = Date.now() - 31_000;
    await eventually(() => expect(names(alice)).toEqual(["Bob"]), 5000);
    ws.close();
  }, 10_000);
});

describe("P6 presence is never stored", () => {
  it("presence traffic doesn't touch the docs or the database", async () => {
    const { server, alice, bob } = await twoPeople();
    const room = server.rooms.get("b1")!;
    const before = {
      content: Y.encodeStateVector(room.content),
      structure: Y.encodeStateVector(room.structure),
      rows: rowCount(server.dbPath),
    };
    for (let i = 0; i < 20; i++) alice.setPresence({ cursor: { anchor: "board", x: i / 20, y: 0.5 } });
    alice.setPresence({ focus: "todo", dragging: "x" });
    await eventually(() => expect(bob.getPeers()[0]?.dragging).toBe("x"));

    expect(Y.encodeStateVector(room.content)).toEqual(before.content);
    expect(Y.encodeStateVector(room.structure)).toEqual(before.structure);
    expect(rowCount(server.dbPath)).toBe(before.rows);
  });
});

describe("P7 one presence per tab", () => {
  it("the same person in two tabs shows up twice", async () => {
    const { server, alice } = await twoPeople();
    const bobSecondTab = await connect(server);
    bobSecondTab.setPresence(idle("Bob", "#1864ab"));
    await eventually(() => expect(names(alice)).toEqual(["Bob", "Bob"]));
    expect(new Set(alice.getPeers().map((p) => p.clientId)).size).toBe(2);
  });
});

describe("P8 offline", () => {
  it("going offline hides everyone; coming back shows them again immediately", async () => {
    const { alice, bob } = await twoPeople();
    alice.disconnect();
    expect(names(alice)).toEqual([]);

    alice.connect();
    await alice.whenSynced();
    // Well under Awareness's 15 s renewal: both directions must be re-announced on reconnect.
    await eventually(() => {
      expect(names(alice)).toEqual(["Bob"]);
      expect(names(bob)).toEqual(["Alice"]);
    }, 1000);
  });

  it("changes made while offline aren't sent, but the latest state is on reconnect", async () => {
    const { alice, bob } = await twoPeople();
    alice.disconnect();
    alice.setPresence({ focus: "card-9" });
    await new Promise((r) => setTimeout(r, 100));
    expect(names(bob)).toEqual([]); // Alice left; nothing was sent while offline

    alice.connect();
    await eventually(() => expect(bob.getPeers()[0]?.focus).toBe("card-9"), 1000);
  });
});

function rowCount(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const { n } = db
    .prepare("SELECT (SELECT COUNT(*) FROM updates) + (SELECT COUNT(*) FROM intents) AS n")
    .get() as {
    n: number;
  };
  db.close();
  return n;
}
