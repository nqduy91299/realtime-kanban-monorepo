import { describe, expect, it } from "vitest";
import { BoardUndo, type BoardClient } from "@kanban/client";
import { cardOrderAt, getText, sortedCardIds, textKey } from "@kanban/shared";
import { connect, eventually, startServer } from "./helpers.js";

const cardsIn = (client: BoardClient, columnId: string) => sortedCardIds(client.getView().board, columnId);
const settled = (...clients: BoardClient[]) =>
  eventually(() => clients.forEach((c) => expect(c.getOutbox()).toHaveLength(0)));

function add(client: BoardClient, cardId: string, columnId = "todo") {
  const board = client.getView().board;
  expect(client.mutate("createCard", { cardId, columnId, order: cardOrderAt(board, columnId, 99) }).ok).toBe(
    true,
  );
}
function move(client: BoardClient, cardId: string, columnId: string) {
  const board = client.getView().board;
  return client.mutate("moveCard", { cardId, columnId, order: cardOrderAt(board, columnId, 99, cardId) });
}

async function twoPeople() {
  const server = await startServer();
  const alice = await connect(server);
  const bob = await connect(server);
  const aliceUndo = new BoardUndo(alice);
  return { alice, bob, aliceUndo };
}

describe("U2 undo is local", () => {
  it("undo reverts only my own latest change, never someone else's", async () => {
    const { alice, bob, aliceUndo } = await twoPeople();
    add(alice, "a1");
    add(bob, "b1");
    await settled(alice, bob);
    await eventually(() => expect(cardsIn(alice, "todo")).toHaveLength(2));

    move(alice, "a1", "doing");
    move(bob, "b1", "done"); // Bob's change is later, but it isn't Alice's to undo
    await settled(alice, bob);
    await eventually(() => expect(cardsIn(alice, "done")).toEqual(["b1"]));

    expect(aliceUndo.undo().ok).toBe(true);
    await settled(alice);
    await eventually(() => {
      expect(cardsIn(bob, "todo")).toEqual(["a1"]); // Alice's move undone
      expect(cardsIn(bob, "done")).toEqual(["b1"]); // Bob's untouched
    });
  });
});

describe("U3 undo goes through the server like any change", () => {
  it("an undo the server rejects is dropped from history", async () => {
    const { alice, aliceUndo } = await twoPeople();
    add(alice, "a1");
    await settled(alice);
    move(alice, "a1", "doing");
    await settled(alice);

    alice.devRejectNext();
    await new Promise((r) => setTimeout(r, 20));
    expect(aliceUndo.undo().ok).toBe(true); // accepted locally…
    await settled(alice); // …rejected by the server
    expect(cardsIn(alice, "doing")).toEqual(["a1"]);
    expect(aliceUndo.canRedo).toBe(false); // nothing to redo: the undo never happened
    expect(aliceUndo.canUndo).toBe(true); // the create is still undoable
  });

  it("an undo that breaks a rule now (WIP limit) is refused and dropped", async () => {
    const { alice, bob, aliceUndo } = await twoPeople();
    add(alice, "a1", "doing");
    await settled(alice);
    move(alice, "a1", "todo"); // out of Doing (limit 3)
    await settled(alice);
    for (const id of ["b1", "b2", "b3"]) add(bob, id, "doing"); // Bob fills Doing
    await settled(bob);
    await eventually(() => expect(cardsIn(alice, "doing")).toHaveLength(3));

    const result = aliceUndo.undo(); // would move a1 back into a full Doing
    expect(result).toMatchObject({ ok: false, code: "WIP_LIMIT" });
    expect(cardsIn(alice, "todo")).toEqual(["a1"]);
    expect(aliceUndo.canRedo).toBe(false);
  });
});

describe("U4 undo never overwrites someone else's later change", () => {
  it("is refused with STALE, and the card stays where the other person put it", async () => {
    const { alice, bob, aliceUndo } = await twoPeople();
    add(alice, "x");
    await settled(alice);
    move(alice, "x", "doing");
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "doing")).toEqual(["x"]));
    move(bob, "x", "done");
    await settled(bob);
    await eventually(() => expect(cardsIn(alice, "done")).toEqual(["x"]));

    expect(aliceUndo.undo()).toMatchObject({ ok: false, code: "STALE" });
    expect(cardsIn(alice, "done")).toEqual(["x"]);
  });

  it("is refused by the server when I hadn't seen the other change yet", async () => {
    const { alice, bob, aliceUndo } = await twoPeople();
    add(alice, "x");
    await settled(alice);
    move(alice, "x", "doing");
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "doing")).toEqual(["x"]));

    const rejected: string[] = [];
    alice.onRejected((r) => rejected.push(r.code));
    alice.setLatency(300); // Alice's network is slow: Bob's move reaches her late
    move(bob, "x", "done");
    await settled(bob); // the server has applied Bob's move
    expect(cardsIn(alice, "doing")).toEqual(["x"]); // Alice still sees the old state

    expect(aliceUndo.undo().ok).toBe(true); // so her undo passes locally…
    await settled(alice);
    expect(rejected).toEqual(["STALE"]); // …and the server refuses it
    await eventually(() => {
      expect(cardsIn(alice, "done")).toEqual(["x"]); // Bob's move stands, for both of them
      expect(cardsIn(bob, "done")).toEqual(["x"]);
    });
  });
});

describe("U6 a new change clears redo", () => {
  it("redo is no longer available after a fresh change", async () => {
    const { alice, aliceUndo } = await twoPeople();
    add(alice, "a1");
    move(alice, "a1", "doing");
    await settled(alice);
    aliceUndo.undo();
    expect(aliceUndo.canRedo).toBe(true);
    add(alice, "a2");
    expect(aliceUndo.canRedo).toBe(false);
  });
});

describe("U8 undo a delete brings back the card with edits made meanwhile", () => {
  it("restores the card, and the other person's text edit is there", async () => {
    const { alice, bob, aliceUndo } = await twoPeople();
    add(alice, "c1");
    getText(alice.content, textKey.cardTitle("c1")).insert(0, "Fix bug");
    await settled(alice);
    await eventually(() => expect(getText(bob.content, textKey.cardTitle("c1")).toString()).toBe("Fix bug"));

    alice.mutate("deleteCard", { cardId: "c1" });
    getText(bob.content, textKey.cardTitle("c1")).insert(7, " now"); // Bob keeps editing
    await settled(alice);

    expect(aliceUndo.undo().ok).toBe(true);
    await settled(alice);
    await eventually(() => {
      expect(cardsIn(bob, "todo")).toEqual(["c1"]);
      expect(getText(alice.content, textKey.cardTitle("c1")).toString()).toBe("Fix bug now");
    });
  });
});

describe("undo, redo, undo round trip", () => {
  it("each step is applied on the server", async () => {
    const { alice, bob, aliceUndo } = await twoPeople();
    add(alice, "a1");
    await settled(alice);
    move(alice, "a1", "done");
    await settled(alice);

    aliceUndo.undo();
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["a1"]));
    aliceUndo.redo();
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "done")).toEqual(["a1"]));
    aliceUndo.undo();
    aliceUndo.undo(); // and the create
    await settled(alice);
    await eventually(() =>
      expect(Object.values(bob.getView().board.cards).every((c) => c.deleted)).toBe(true),
    );
    aliceUndo.redo(); // redo the create = restore
    await settled(alice);
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["a1"]));
  });
});

describe("a change the server rejects isn't undoable", () => {
  it("is removed from history", async () => {
    const { alice, aliceUndo } = await twoPeople();
    alice.devRejectNext();
    await new Promise((r) => setTimeout(r, 20));
    add(alice, "a1");
    expect(aliceUndo.canUndo).toBe(true);
    await settled(alice);
    expect(aliceUndo.canUndo).toBe(false);
  });
});

describe("U9 history is capped", () => {
  it("keeps the latest 100 entries", async () => {
    const { alice } = await twoPeople();
    const undo = new BoardUndo(alice, 100);
    add(alice, "a1");
    for (let i = 0; i < 120; i++) move(alice, "a1", i % 2 === 0 ? "done" : "todo");
    let steps = 0;
    while (undo.canUndo) {
      undo.undo();
      steps++;
    }
    expect(steps).toBe(100);
  });
});
