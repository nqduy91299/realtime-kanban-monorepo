import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { IndexedDbStore } from "../src/index.js";
import type { Intent } from "@kanban/shared";

const intent = (id: string, cardId = "c1"): Intent => ({ id, name: "deleteCard", args: { cardId } });
const flush = () => new Promise((r) => setTimeout(r, 20));

function textUpdates(n: number): { updates: Uint8Array[]; expected: string } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));
  for (let i = 0; i < n; i++) doc.getText("t").insert(i, String(i % 10));
  return { updates, expected: doc.getText("t").toString() };
}

describe("IndexedDbStore", () => {
  it("an empty board loads as nothing", async () => {
    const store = new IndexedDbStore(new IDBFactory());
    expect(await store.load("b1")).toEqual({ content: null, structure: null, outbox: [] });
  });

  it("keeps doc updates per board and per doc, across a new connection (a reload)", async () => {
    const factory = new IDBFactory();
    const first = new IndexedDbStore(factory);
    const { updates, expected } = textUpdates(5);
    for (const u of updates) first.appendUpdate("b1", "content", u);
    first.appendUpdate("b2", "content", textUpdates(1).updates[0]!);
    await flush();
    first.close();

    const second = new IndexedDbStore(factory);
    const saved = await second.load("b1");
    expect(saved.structure).toBeNull();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, saved.content!);
    expect(doc.getText("t").toString()).toBe(expected);
  });

  it("compacts a long log into one row without losing anything", async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbStore(factory);
    const { updates, expected } = textUpdates(150);
    for (const u of updates) store.appendUpdate("b1", "content", u);
    await flush();

    const first = await store.load("b1"); // compacts
    const count = await rowCount(factory, "updates");
    expect(count).toBe(1);
    const again = await store.load("b1");
    for (const bytes of [first.content!, again.content!]) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, bytes);
      expect(doc.getText("t").toString()).toBe(expected);
    }
  });

  it("keeps the outbox in creation order, and removes by id (F5)", async () => {
    const store = new IndexedDbStore(new IDBFactory());
    store.addIntent("b1", intent("i1"));
    store.addIntent("b1", intent("i2"));
    store.addIntent("b2", intent("other"));
    store.addIntent("b1", intent("i3"));
    store.removeIntent("b1", "i2");
    await flush();
    expect((await store.load("b1")).outbox.map((i) => i.id)).toEqual(["i1", "i3"]);
  });

  it("two tabs on the same board never overwrite each other's pending changes", async () => {
    const factory = new IDBFactory();
    const tabA = new IndexedDbStore(factory);
    const tabB = new IndexedDbStore(factory);
    tabA.addIntent("b1", intent("a1"));
    tabB.addIntent("b1", intent("b1"));
    tabA.addIntent("b1", intent("a2"));
    tabB.removeIntent("b1", "b1");
    await flush();
    expect((await new IndexedDbStore(factory).load("b1")).outbox.map((i) => i.id)).toEqual(["a1", "a2"]);
  });
});

function rowCount(factory: IDBFactory, store: string): Promise<number> {
  return new Promise((resolve) => {
    const open = factory.open("kanban", 1);
    open.onsuccess = () => {
      const req = open.result.transaction(store).objectStore(store).count();
      req.onsuccess = () => {
        resolve(req.result);
        open.result.close();
      };
    };
  });
}
