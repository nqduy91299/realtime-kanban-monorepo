import * as Y from "yjs";
import { keyBetween } from "./order.js";
import type { BoardState, CardValue, Change, ColumnValue } from "./types.js";

/* ---------- structure doc (D2): server-written, clients only read ---------- */

export function structureMaps(doc: Y.Doc) {
  return {
    columns: doc.getMap<ColumnValue>("columns"),
    cards: doc.getMap<CardValue>("cards"),
  };
}

export function readBoardState(doc: Y.Doc): BoardState {
  const { columns, cards } = structureMaps(doc);
  return { columns: columns.toJSON(), cards: cards.toJSON() };
}

/** Each value is set as one plain object, so Yjs replaces it atomically (no half-moved card). */
export function writeChanges(doc: Y.Doc, changes: readonly Change[], origin?: unknown): void {
  const { columns, cards } = structureMaps(doc);
  doc.transact(() => {
    for (const change of changes) {
      if (change.kind === "card") cards.set(change.id, change.value);
      else columns.set(change.id, change.value);
    }
  }, origin);
}

/* ---------- content doc: one top-level Y.Text per text field ---------- */

/**
 * Why top-level types instead of a Y.Map of Y.Text?
 * If two clients each did `map.set(key, new Y.Text())` for the same key, the map would keep
 * one of them and the other client's typing would vanish. A top-level `doc.getText(name)` is
 * identified by its name alone, so every client gets the same text. There's nothing to race on.
 * The trade-off: top-level types can't be deleted. That's fine, because cards are soft-deleted.
 */
export const textKey = {
  cardTitle: (cardId: string) => `card:${cardId}:title`,
  cardDescription: (cardId: string) => `card:${cardId}:desc`,
  columnTitle: (columnId: string) => `column:${columnId}:title`,
};

export function getText(doc: Y.Doc, key: string): Y.Text {
  return doc.getText(key);
}

/* ---------- a new board ---------- */

export const DEFAULT_COLUMNS = [
  { id: "todo", title: "To do", wipLimit: null },
  { id: "doing", title: "Doing", wipLimit: 3 },
  { id: "done", title: "Done", wipLimit: null },
] as const;

/** Called by the server when it creates a board that has never existed. */
export function seedBoard(structure: Y.Doc, content: Y.Doc, origin?: unknown): void {
  let order: string | null = null;
  const changes: Change[] = DEFAULT_COLUMNS.map(({ id, wipLimit }) => {
    order = keyBetween(order, null);
    return { kind: "column", id, value: { order, wipLimit, deleted: false } };
  });
  writeChanges(structure, changes, origin);
  content.transact(() => {
    for (const { id, title } of DEFAULT_COLUMNS) getText(content, textKey.columnTitle(id)).insert(0, title);
  }, origin);
}
