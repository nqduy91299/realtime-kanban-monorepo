import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import type { DocName, RejectCode } from "@kanban/shared";

/**
 * Append-only log of Yjs updates per (board, doc), the same approach y-leveldb uses.
 * Writing one small row per update is cheap. Once a doc has many rows, they're merged
 * into a single row (`compact`), so loading a board never has to replay a long history.
 */
export class Store {
  private db: DatabaseSync;
  private static readonly COMPACT_AFTER = 500;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS updates (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        board TEXT NOT NULL,
        doc   TEXT NOT NULL,
        data  BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS updates_by_doc ON updates (board, doc, id);
      -- R8: every intent id the server has decided, so a resent intent is answered, not re-applied.
      -- code is NULL when the intent was accepted.
      CREATE TABLE IF NOT EXISTS intents (
        board TEXT NOT NULL,
        id    TEXT NOT NULL,
        code  TEXT,
        PRIMARY KEY (board, id)
      );
    `);
  }

  /** Returns true if the doc had any stored history. */
  load(board: string, name: DocName, doc: Y.Doc): boolean {
    const rows = this.db
      .prepare("SELECT data FROM updates WHERE board = ? AND doc = ? ORDER BY id")
      .all(board, name) as { data: Uint8Array }[];
    if (rows.length === 0) return false;
    Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => r.data)));
    if (rows.length > Store.COMPACT_AFTER) this.compact(board, name, doc);
    return true;
  }

  append(board: string, name: DocName, update: Uint8Array): void {
    this.db.prepare("INSERT INTO updates (board, doc, data) VALUES (?, ?, ?)").run(board, name, update);
  }

  intentResult(board: string, id: string): { code: RejectCode | null } | undefined {
    return this.db.prepare("SELECT code FROM intents WHERE board = ? AND id = ?").get(board, id) as
      | { code: RejectCode | null }
      | undefined;
  }

  recordIntent(board: string, id: string, code: RejectCode | null): void {
    this.db.prepare("INSERT INTO intents (board, id, code) VALUES (?, ?, ?)").run(board, id, code);
  }

  /**
   * Run `fn` in one SQLite transaction. Used so a structure update and the record of the intent
   * that caused it are saved together: a crash can't leave "applied but not remembered", which
   * would make a retry apply it twice.
   */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private compact(board: string, name: DocName, doc: Y.Doc): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM updates WHERE board = ? AND doc = ?").run(board, name);
      this.append(board, name, Y.encodeStateAsUpdate(doc));
    });
  }

  close(): void {
    this.db.close();
  }
}
