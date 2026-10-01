import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { BoardClient, Rejection } from "@kanban/client";
import { getText, keyBetween, readBoardState, sortedCardIds, textKey } from "@kanban/shared";
import { connect, eventually, startServer } from "./helpers.js";

/* Default board: todo · doing (WIP 3) · done */

const cardsIn = (client: BoardClient, columnId: string) => sortedCardIds(client.getView().board, columnId);
const confirmedCardsIn = (client: BoardClient, columnId: string) =>
  sortedCardIds(readBoardState(client.structure), columnId);

/** Wait until every intent is answered. */
const settled = (...clients: BoardClient[]) =>
  eventually(() => clients.forEach((c) => expect(c.getOutbox()).toHaveLength(0)));

function addCard(client: BoardClient, cardId: string, columnId = "todo") {
  const last = cardsIn(client, columnId).at(-1);
  const order = keyBetween(last ? client.getView().board.cards[last]!.order : null, null);
  const result = client.mutate("createCard", { cardId, columnId, order });
  expect(result.ok).toBe(true);
}

function move(client: BoardClient, cardId: string, columnId: string) {
  const last = cardsIn(client, columnId).at(-1);
  const order = keyBetween(last ? client.getView().board.cards[last]!.order : null, null);
  return client.mutate("moveCard", { cardId, columnId, order });
}

function rejections(client: BoardClient): Rejection[] {
  const list: Rejection[] = [];
  client.onRejected((r) => list.push(r));
  return list;
}

async function board() {
  const server = await startServer();
  const alice = await connect(server);
  const bob = await connect(server);
  return { server, alice, bob };
}

describe("O1 optimistic: the change is visible before any reply", () => {
  it("mutate() updates the view synchronously and marks it pending", async () => {
    const { alice } = await board();
    alice.setLatency(300);
    addCard(alice, "c1");
    // Same tick: no network round trip has happened yet.
    expect(cardsIn(alice, "todo")).toEqual(["c1"]);
    expect(alice.getView().pending.has("c1")).toBe(true); // O2
    expect(confirmedCardsIn(alice, "todo")).toEqual([]);
  });
});

describe("O3 ack: nothing moves", () => {
  it("the card never flickers back while waiting for the ack", async () => {
    const { alice } = await board();
    addCard(alice, "c1");
    await settled(alice);

    const seen: string[][] = [];
    alice.subscribe(() => seen.push(cardsIn(alice, "doing")));
    move(alice, "c1", "doing");
    await settled(alice);

    expect(seen.length).toBeGreaterThanOrEqual(3); // optimistic, structure update, ack
    expect(seen.every((cards) => cards.includes("c1"))).toBe(true);
    expect(alice.getView().pending.size).toBe(0);
  });
});

describe("O4 nack: rollback", () => {
  it("the view returns to the confirmed state and a rejection is reported", async () => {
    const { alice } = await board();
    addCard(alice, "c1");
    await settled(alice);
    const rejected = rejections(alice);

    alice.devRejectNext();
    move(alice, "c1", "done");
    expect(cardsIn(alice, "done")).toEqual(["c1"]); // optimistic

    await settled(alice);
    expect(cardsIn(alice, "done")).toEqual([]);
    expect(cardsIn(alice, "todo")).toEqual(["c1"]);
    expect(rejected.map((r) => [r.code, r.intent.name])).toEqual([["DEV_REJECT", "moveCard"]]);
  });
});

describe("O5 rejections cascade", () => {
  it("a move of a card whose creation was rejected is rejected too", async () => {
    const { alice } = await board();
    const rejected = rejections(alice);
    alice.devRejectNext();
    addCard(alice, "c1");
    move(alice, "c1", "doing"); // valid locally: the view has c1
    await settled(alice);

    expect(rejected.map((r) => r.intent.name)).toEqual(["createCard", "moveCard"]);
    expect(Object.keys(alice.getView().board.cards)).toEqual([]);
  });
});

describe("O6 rebase", () => {
  it("someone else's change appears while mine is still pending", async () => {
    const { alice, bob } = await board();
    alice.setLatency(200);
    addCard(alice, "a1");
    addCard(bob, "b1", "done");

    await eventually(() => expect(cardsIn(alice, "done")).toEqual(["b1"]));
    expect(alice.getView().pending.has("a1")).toBe(true); // still waiting
    expect(cardsIn(alice, "todo")).toEqual(["a1"]); // and still shown
    await settled(alice, bob);
  });
});

describe("O7 resend after a lost reply", () => {
  it("the same intent is sent again and applied once", async () => {
    const server = await startServer();
    const alice = await connect(server, "b1", "editor", { ackTimeoutMs: 100 });
    alice.devDropNextReply();
    addCard(alice, "c1");
    await settled(alice);
    expect(confirmedCardsIn(alice, "todo")).toEqual(["c1"]);
  });
});

describe("R8 idempotency", () => {
  it("a replayed intent id is answered with the original result and not applied again", async () => {
    const { server, alice } = await board();
    const ws = new WebSocket(`ws://localhost:${server.port}/boards/b1`);
    await new Promise((r) => (ws.onopen = r));
    const answers: string[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.t === "ack" || m.t === "nack") answers.push(`${m.t}:${m.id}`);
    };
    const create = {
      t: "intent",
      id: "fixed-1",
      name: "createCard",
      args: { cardId: "c1", columnId: "todo", order: "a0" },
    };
    ws.send(JSON.stringify(create));
    ws.send(JSON.stringify(create)); // would be INVALID (duplicate card) if applied again
    await eventually(() => expect(answers).toEqual(["ack:fixed-1", "ack:fixed-1"]));
    ws.close();
    await eventually(() => expect(confirmedCardsIn(alice, "todo")).toEqual(["c1"]));
  });

  it("remembers decided intents across a server restart", async () => {
    const first = await startServer();
    const alice = await connect(first);
    const result = alice.mutate("createCard", { cardId: "c1", columnId: "todo", order: "a0" });
    if (!result.ok) throw new Error("expected ok");
    await settled(alice);
    await first.close();

    // Suppose Alice's ack was lost and she resends the same intent to the restarted server.
    const second = await startServer(first.dbPath);
    const ws = new WebSocket(`ws://localhost:${second.port}/boards/b1`);
    await new Promise((r) => (ws.onopen = r));
    const answer = new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === "ack" || m.t === "nack") resolve(m.t);
      };
    });
    ws.send(
      JSON.stringify({
        t: "intent",
        id: result.id,
        name: "createCard",
        args: { cardId: "c1", columnId: "todo", order: "a0" },
      }),
    );
    // Without the stored record this would be a nack: c1 already exists, so it's INVALID.
    expect(await answer).toBe("ack");
    ws.close();
  });

  it("an intent in flight when the connection drops is resent on reconnect, not duplicated", async () => {
    const { alice, bob } = await board();
    alice.setLatency(500); // wide enough that the ack is still in flight when we disconnect, even under load
    addCard(alice, "c1");
    // Wait until the server has applied it (Bob sees it), then cut Alice off before her ack arrives.
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["c1"]));
    alice.disconnect();
    expect(alice.getOutbox()).toHaveLength(1);
    alice.setLatency(0);
    alice.connect();
    await settled(alice);
    expect(cardsIn(alice, "todo")).toEqual(["c1"]);
    expect(cardsIn(bob, "todo")).toEqual(["c1"]);
  });
});

describe("R1 viewers can't change structure", () => {
  it("is refused locally, and by the server if sent anyway", async () => {
    const { server } = await board();
    const viewer = await connect(server, "b1", "viewer");
    expect(viewer.mutate("createCard", { cardId: "v1", columnId: "todo", order: "a0" })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });

    const ws = new WebSocket(`ws://localhost:${server.port}/boards/b1?role=viewer`);
    await new Promise((r) => (ws.onopen = r));
    const answer = new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.t === "nack") resolve(m.code);
      };
    });
    ws.send(JSON.stringify({ t: "intent", id: "v-1", name: "deleteColumn", args: { columnId: "done" } }));
    expect(await answer).toBe("FORBIDDEN");
    ws.close();
  });
});

/* ---------- conflicts between two users (§3) ---------- */
// To make two changes truly concurrent, Bob goes offline, changes something, Alice changes
// something, then Bob comes back. Bob's queued intent reaches the server *after* Alice's.

describe("C4 both move the same card", () => {
  it("the later-processed move wins, same everywhere, no duplicate", async () => {
    const { alice, bob } = await board();
    addCard(alice, "c1");
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["c1"]));

    bob.disconnect();
    move(bob, "c1", "done");
    move(alice, "c1", "doing");
    await settled(alice);
    bob.connect();
    await settled(bob);

    await eventually(() => {
      for (const c of [alice, bob]) {
        expect(cardsIn(c, "done")).toEqual(["c1"]);
        expect(cardsIn(c, "doing")).toEqual([]);
        expect(cardsIn(c, "todo")).toEqual([]);
      }
    });
  });
});

describe("C5 move + edit title", () => {
  it("both apply", async () => {
    const { alice, bob } = await board();
    addCard(alice, "c1");
    getText(alice.content, textKey.cardTitle("c1")).insert(0, "Write docs");
    await settled(alice);
    await eventually(() =>
      expect(getText(bob.content, textKey.cardTitle("c1")).toString()).toBe("Write docs"),
    );

    move(alice, "c1", "doing");
    getText(bob.content, textKey.cardTitle("c1")).insert(10, " today");
    await settled(alice);
    await eventually(() => {
      for (const c of [alice, bob]) {
        expect(cardsIn(c, "doing")).toEqual(["c1"]);
        expect(getText(c.content, textKey.cardTitle("c1")).toString()).toBe("Write docs today");
      }
    });
  });
});

describe("C6 delete + edit title", () => {
  it("the card is hidden, the edit is kept, and restoring brings both back", async () => {
    const { alice, bob } = await board();
    addCard(alice, "c1");
    getText(alice.content, textKey.cardTitle("c1")).insert(0, "Fix bug");
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["c1"]));

    bob.disconnect();
    getText(bob.content, textKey.cardTitle("c1")).insert(7, " now");
    alice.mutate("deleteCard", { cardId: "c1" });
    await settled(alice);
    bob.connect();
    await bob.whenSynced();

    await eventually(() => {
      expect(cardsIn(bob, "todo")).toEqual([]);
      expect(getText(alice.content, textKey.cardTitle("c1")).toString()).toBe("Fix bug now");
    });
    alice.mutate("restoreCard", { cardId: "c1" });
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["c1"]));
  });
});

describe("C7 delete vs move", () => {
  it("delete first → the move is rolled back with CARD_DELETED", async () => {
    const { alice, bob } = await board();
    addCard(alice, "c1");
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["c1"]));
    const rejected = rejections(bob);

    bob.disconnect();
    move(bob, "c1", "done");
    alice.mutate("deleteCard", { cardId: "c1" });
    await settled(alice);
    bob.connect();
    await settled(bob);

    expect(rejected.map((r) => r.code)).toEqual(["CARD_DELETED"]);
    expect(cardsIn(bob, "done")).toEqual([]);
  });
});

describe("C8 both insert at the same slot", () => {
  it("both cards exist, in the same order on both screens", async () => {
    const { alice, bob } = await board();
    bob.disconnect();
    const key = keyBetween(null, null); // both compute the same key for "first card in To do"
    alice.mutate("createCard", { cardId: "zz-alice", columnId: "todo", order: key });
    bob.mutate("createCard", { cardId: "aa-bob", columnId: "todo", order: key });
    await settled(alice);
    bob.connect();
    await settled(bob);

    await eventually(() => {
      expect(cardsIn(alice, "todo")).toEqual(["aa-bob", "zz-alice"]);
      expect(cardsIn(bob, "todo")).toEqual(["aa-bob", "zz-alice"]);
    });
  });
});

describe("C9 delete an empty column vs move a card into it", () => {
  it("the later one is rolled back", async () => {
    const { alice, bob } = await board();
    addCard(alice, "c1");
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["c1"]));
    const rejected = rejections(bob);

    bob.disconnect();
    move(bob, "c1", "done");
    alice.mutate("deleteColumn", { columnId: "done" });
    await settled(alice);
    bob.connect();
    await settled(bob);

    expect(rejected.map((r) => r.code)).toEqual(["COLUMN_DELETED"]);
    expect(cardsIn(bob, "todo")).toEqual(["c1"]);
  });
});

describe("C10 two moves into a column with one free slot", () => {
  it("the first is accepted, the second rolled back with WIP_LIMIT", async () => {
    const { alice, bob } = await board();
    for (const id of ["d1", "d2"]) addCard(alice, id, "doing"); // doing: 2 of 3
    for (const id of ["a1", "b1"]) addCard(alice, id);
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["a1", "b1"]));
    const rejected = rejections(bob);

    bob.disconnect();
    expect(move(bob, "b1", "doing").ok).toBe(true); // fits locally: Bob still sees 2 of 3
    expect(move(alice, "a1", "doing").ok).toBe(true);
    await settled(alice);
    bob.connect();
    await settled(bob);

    expect(rejected.map((r) => r.code)).toEqual(["WIP_LIMIT"]);
    for (const c of [alice, bob]) {
      expect(cardsIn(c, "doing")).toEqual(["d1", "d2", "a1"]);
      expect(cardsIn(c, "todo")).toEqual(["b1"]);
    }
  });

  it("a move that's already invalid locally is refused without a round trip", async () => {
    const { alice } = await board();
    for (const id of ["d1", "d2", "d3"]) addCard(alice, id, "doing");
    addCard(alice, "a1");
    expect(move(alice, "a1", "doing")).toEqual({ ok: false, code: "WIP_LIMIT" });
    expect(alice.getOutbox()).toHaveLength(4); // just the four creates
  });
});

describe("C11 both reorder the same column", () => {
  it("the later-processed reorder wins", async () => {
    const { alice, bob } = await board();
    bob.disconnect();
    bob.mutate("moveColumn", { columnId: "done", order: keyBetween(null, "a0") }); // first
    alice.mutate("moveColumn", { columnId: "done", order: keyBetween("a0", "a1") }); // between todo and doing
    await settled(alice);
    bob.connect();
    await settled(bob);
    await eventually(() => {
      for (const c of [alice, bob]) {
        const columns = c.getView().board.columns;
        expect(Object.keys(columns).sort((x, y) => (columns[x]!.order < columns[y]!.order ? -1 : 1))).toEqual(
          ["done", "todo", "doing"],
        );
      }
    });
  });
});

describe("C12 lower the WIP limit vs move a card in", () => {
  it("the later one is rolled back", async () => {
    const { alice, bob } = await board();
    addCard(alice, "d1", "doing");
    addCard(alice, "a1");
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["a1"]));
    const rejected = rejections(bob);

    bob.disconnect();
    bob.mutate("setWipLimit", { columnId: "doing", wipLimit: 1 });
    move(alice, "a1", "doing");
    await settled(alice);
    bob.connect();
    await settled(bob);

    expect(rejected.map((r) => r.code)).toEqual(["WIP_BELOW_COUNT"]);
    expect(bob.getView().board.columns.doing?.wipLimit).toBe(3);
  });
});

describe("S1 structure is identical everywhere after settling", () => {
  it("server and clients hold byte-identical structure docs", async () => {
    const { server, alice, bob } = await board();
    addCard(alice, "c1");
    addCard(bob, "c2");
    move(alice, "c1", "doing");
    await settled(alice, bob);
    await eventually(() => {
      const serverState = Y.encodeStateAsUpdate(server.rooms.get("b1")!.structure);
      expect(Y.encodeStateAsUpdate(alice.structure)).toEqual(serverState);
      expect(Y.encodeStateAsUpdate(bob.structure)).toEqual(serverState);
    });
  });
});
