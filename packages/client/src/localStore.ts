import * as Y from "yjs";
import type { DocName, Intent } from "@kanban/shared";

/**
 * What a board needs to survive a reload while offline (F3): both docs and the outbox.
 * Presence is deliberately not here (P6).
 */
export interface LocalSnapshot {
  content: Uint8Array | null;
  structure: Uint8Array | null;
  /** Pending intents, oldest first. */
  outbox: Intent[];
}

/**
 * Writes are fire-and-forget (the UI never waits on disk), but they are applied in the order
 * they were issued. IndexedDB runs transactions on the same store in creation order.
 */
export interface LocalStore {
  load(boardId: string): Promise<LocalSnapshot>;
  appendUpdate(boardId: string, doc: DocName, update: Uint8Array): void;
  addIntent(boardId: string, intent: Intent): void;
  removeIntent(boardId: string, intentId: string): void;
}

const DB_NAME = "kanban";
const VERSION = 1;

interface UpdateRow {
  board: string;
  doc: DocName;
  data: Uint8Array;
}
interface IntentRow {
  board: string;
  id: string;
  intent: Intent;
}

/**
 * Same design as the server's SQLite store: an append-only log of Yjs updates, merged into one
 * row when it gets long. The outbox is one row per intent (not one array per board), so two tabs
 * on the same board never overwrite each other's pending changes. A tab that loads another tab's
 * intents and sends them too is harmless: the server answers a repeated id without applying it (R8).
 */
export class IndexedDbStore implements LocalStore {
  private static readonly COMPACT_AFTER = 100;
  private db: Promise<IDBDatabase>;

  constructor(private factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const updates = db.createObjectStore("updates", { autoIncrement: true });
        updates.createIndex("byDoc", ["board", "doc"]);
        const outbox = db.createObjectStore("outbox", { autoIncrement: true });
        outbox.createIndex("byBoard", "board");
        outbox.createIndex("byId", "id", { unique: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(boardId: string): Promise<LocalSnapshot> {
    const [content, structure, outbox] = await Promise.all([
      this.loadDoc(boardId, "content"),
      this.loadDoc(boardId, "structure"),
      this.loadOutbox(boardId),
    ]);
    return { content, structure, outbox };
  }

  appendUpdate(boardId: string, doc: DocName, update: Uint8Array): void {
    void this.write("updates", (store) => store.add({ board: boardId, doc, data: update } satisfies UpdateRow));
  }

  addIntent(boardId: string, intent: Intent): void {
    void this.write("outbox", (store) => store.add({ board: boardId, id: intent.id, intent } satisfies IntentRow));
  }

  removeIntent(_boardId: string, intentId: string): void {
    void this.write("outbox", (store) => {
      const request = store.index("byId").getKey(intentId);
      request.onsuccess = () => {
        if (request.result !== undefined) store.delete(request.result);
      };
    });
  }

  close(): void {
    void this.db.then((db) => db.close());
  }

  /** Read every update for one doc, merged. Compacts the log in the same transaction if it's long. */
  private async loadDoc(boardId: string, doc: DocName): Promise<Uint8Array | null> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("updates", "readwrite");
      const store = tx.objectStore("updates");
      const range = IDBKeyRange.only([boardId, doc]);
      const keysReq = store.index("byDoc").getAllKeys(range);
      const rowsReq = store.index("byDoc").getAll(range);
      let merged: Uint8Array | null = null;
      rowsReq.onsuccess = () => {
        const rows = rowsReq.result as UpdateRow[];
        if (rows.length === 0) return;
        merged = Y.mergeUpdates(rows.map((r) => r.data));
        if (rows.length > IndexedDbStore.COMPACT_AFTER) {
          // Only the rows read above are replaced. Rows another tab adds meanwhile get higher keys and stay.
          for (const key of keysReq.result) store.delete(key);
          store.add({ board: boardId, doc, data: merged } satisfies UpdateRow);
        }
      };
      tx.oncomplete = () => resolve(merged);
      tx.onerror = () => reject(tx.error);
    });
  }

  private async loadOutbox(boardId: string): Promise<Intent[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      // Rows come back in key order, and keys are auto-incremented, so this is creation order (F5).
      const request = db.transaction("outbox").objectStore("outbox").index("byBoard").getAll(boardId);
      request.onsuccess = () => {
        const rows = request.result as IntentRow[];
        const seen = new Set<string>();
        resolve(rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => r.intent));
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async write(storeName: "updates" | "outbox", fn: (store: IDBObjectStore) => void): Promise<void> {
    try {
      const db = await this.db;
      const tx = db.transaction(storeName, "readwrite");
      fn(tx.objectStore(storeName));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      // Quota exceeded, private mode, etc. The app keeps working; this change just won't survive a reload.
      console.warn("kanban: couldn't save locally", error);
    }
  }
}

/** A store that keeps everything in memory: for tests, and when IndexedDB isn't available. */
export class MemoryStore implements LocalStore {
  private updates: { board: string; doc: DocName; data: Uint8Array }[] = [];
  private intents: { board: string; intent: Intent }[] = [];

  async load(boardId: string): Promise<LocalSnapshot> {
    const merged = (doc: DocName) => {
      const rows = this.updates.filter((u) => u.board === boardId && u.doc === doc).map((u) => u.data);
      return rows.length ? Y.mergeUpdates(rows) : null;
    };
    return {
      content: merged("content"),
      structure: merged("structure"),
      outbox: this.intents.filter((i) => i.board === boardId).map((i) => i.intent),
    };
  }
  appendUpdate(boardId: string, doc: DocName, update: Uint8Array): void {
    this.updates.push({ board: boardId, doc, data: update });
  }
  addIntent(boardId: string, intent: Intent): void {
    this.intents.push({ board: boardId, intent });
  }
  removeIntent(_boardId: string, intentId: string): void {
    this.intents = this.intents.filter((i) => i.intent.id !== intentId);
  }
}
