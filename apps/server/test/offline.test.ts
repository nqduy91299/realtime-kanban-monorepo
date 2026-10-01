import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { BoardClient, IndexedDbStore, type Rejection } from "@kanban/client";
import { cardOrderAt, getText, sortedCardIds, textKey } from "@kanban/shared";
import { connect, eventually, startServer } from "./helpers.js";

/* A "device" is one browser profile: its own IndexedDB. A "reload" is a new BoardClient on the same device. */

const cardsIn = (client: BoardClient, columnId: string) => sortedCardIds(client.getView().board, columnId);
const title = (client: BoardClient, cardId: string) => getText(client.content, textKey.cardTitle(cardId));
const settled = (client: BoardClient) => eventually(() => expect(client.getOutbox()).toHaveLength(0));
const diskFlush = () => new Promise((r) => setTimeout(r, 50));

function openOn(server: { port: number }, device: IDBFactory) {
  const client = new BoardClient({
    url: `ws://localhost:${server.port}`,
    boardId: "b1",
    reconnect: false,
    store: new IndexedDbStore(device),
  });
  return client;
}

function add(client: BoardClient, cardId: string, text: string, columnId = "todo") {
  const board = client.getView().board;
  const result = client.mutate("createCard", { cardId, columnId, order: cardOrderAt(board, columnId, 99) });
  expect(result.ok).toBe(true);
  title(client, cardId).insert(0, text);
}

function move(client: BoardClient, cardId: string, columnId: string) {
  const board = client.getView().board;
  return client.mutate("moveCard", { cardId, columnId, order: cardOrderAt(board, columnId, 99, cardId) });
}

describe("F2 + F3 working offline, then reloading while still offline", () => {
  it("everything done offline is still there after a reload, and syncs once back online", async () => {
    const server = await startServer();
    const bob = await connect(server);
    const device = new IDBFactory();

    const alice = openOn(server, device);
    alice.connect();
    await alice.whenSynced();
    add(alice, "c1", "Plan sprint");
    await settled(alice);

    alice.disconnect(); // offline from here on
    add(alice, "c2", "Written offline"); // F2: structure change while offline
    move(alice, "c2", "done"); // F5: depends on the create before it
    move(alice, "c1", "doing");
    title(alice, "c1").insert(11, " v2"); // F2: text change while offline
    expect(alice.getOutbox()).toHaveLength(3);
    await diskFlush();
    alice.destroy(); // the reload

    const reloaded = openOn(server, device);
    await reloaded.ready; // still offline: everything comes from IndexedDB
    expect(cardsIn(reloaded, "doing")).toEqual(["c1"]);
    expect(cardsIn(reloaded, "done")).toEqual(["c2"]);
    expect(title(reloaded, "c1").toString()).toBe("Plan sprint v2");
    expect(title(reloaded, "c2").toString()).toBe("Written offline");
    expect([...reloaded.getView().pending].sort()).toEqual(["c1", "c2"]); // still waiting for the server
    expect(bob.getView().board.cards.c2).toBeUndefined(); // nothing reached the server yet

    const rejected: Rejection[] = [];
    reloaded.onRejected((r) => rejected.push(r));
    reloaded.connect();
    await settled(reloaded);

    expect(rejected).toEqual([]); // F5: sent in order, so the move after the create is valid
    await eventually(() => {
      expect(cardsIn(bob, "doing")).toEqual(["c1"]);
      expect(cardsIn(bob, "done")).toEqual(["c2"]);
      expect(title(bob, "c1").toString()).toBe("Plan sprint v2"); // F4: text went up via sync on reconnect
      expect(title(bob, "c2").toString()).toBe("Written offline");
    });
    reloaded.destroy();
  });
});

describe("F6 an offline change that's no longer valid", () => {
  it("is rolled back after the flush, with a rejection naming the card", async () => {
    const server = await startServer();
    const bob = await connect(server);
    const alice = openOn(server, new IDBFactory());
    alice.connect();
    await alice.whenSynced();
    add(alice, "mine", "Offline move");
    await settled(alice);

    alice.disconnect();
    expect(move(alice, "mine", "doing").ok).toBe(true); // Doing looks empty to Alice
    for (const id of ["b1", "b2", "b3"]) add(bob, id, id, "doing"); // Bob fills it (limit 3)
    await settled(bob);

    const rejected: Rejection[] = [];
    alice.onRejected((r) => rejected.push(r));
    alice.connect();
    await settled(alice);

    expect(rejected.map((r) => [r.code, "cardId" in r.intent.args && r.intent.args.cardId])).toEqual([
      ["WIP_LIMIT", "mine"],
    ]);
    expect(cardsIn(alice, "todo")).toEqual(["mine"]);
    expect(cardsIn(alice, "doing")).toEqual(["b1", "b2", "b3"]);
    alice.destroy();
  });
});

describe("F8 a reply lost just before a reload", () => {
  it("the saved intent is resent, answered from the server's record, and not applied twice", async () => {
    const server = await startServer();
    const bob = await connect(server);
    const device = new IDBFactory();
    const alice = openOn(server, device);
    alice.connect();
    await alice.whenSynced();

    alice.devDropNextReply();
    add(alice, "c1", "Once");
    await eventually(() => expect(cardsIn(bob, "todo")).toEqual(["c1"])); // server applied it…
    expect(alice.getOutbox()).toHaveLength(1); // …but Alice never heard back
    await diskFlush();
    alice.destroy();

    const reloaded = openOn(server, device);
    await reloaded.ready;
    expect(reloaded.getOutbox().map((i) => i.name)).toEqual(["createCard"]); // saved, still unanswered
    reloaded.connect();
    await reloaded.whenSynced();
    await settled(reloaded);
    expect(cardsIn(reloaded, "todo")).toEqual(["c1"]);
    expect(cardsIn(bob, "todo")).toEqual(["c1"]);
    await diskFlush();
    expect((await new IndexedDbStore(device).load("b1")).outbox).toEqual([]); // cleared on disk too
    reloaded.destroy();
  });
});

describe("F9 a board never opened online", () => {
  it("has no data offline, and has it once synced", async () => {
    const server = await startServer();
    const client = openOn(server, new IDBFactory());
    await client.ready;
    expect(client.hasData).toBe(false);

    client.connect();
    await client.whenSynced();
    expect(client.hasData).toBe(true);
    client.destroy();
  });
});

describe("F7 two people edit the same title offline, both reload, then reconnect", () => {
  it("both edits are merged", async () => {
    const server = await startServer();
    const [deviceA, deviceB] = [new IDBFactory(), new IDBFactory()];
    const alice = openOn(server, deviceA);
    const bob = openOn(server, deviceB);
    for (const c of [alice, bob]) c.connect();
    await Promise.all([alice.whenSynced(), bob.whenSynced()]);
    add(alice, "c1", "Fix bug");
    await settled(alice);
    await eventually(() => expect(title(bob, "c1").toString()).toBe("Fix bug"));

    alice.disconnect();
    bob.disconnect();
    title(alice, "c1").insert(7, " now");
    title(bob, "c1").insert(0, "Urgent: ");
    await diskFlush();
    alice.destroy();
    bob.destroy();

    const [a2, b2] = [openOn(server, deviceA), openOn(server, deviceB)];
    for (const c of [a2, b2]) c.connect();
    await Promise.all([a2.whenSynced(), b2.whenSynced()]);
    await eventually(() => {
      expect(title(a2, "c1").toString()).toBe("Urgent: Fix bug now");
      expect(title(b2, "c1").toString()).toBe("Urgent: Fix bug now");
    });
    a2.destroy();
    b2.destroy();
  });
});
