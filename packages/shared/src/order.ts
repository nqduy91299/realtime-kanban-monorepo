// TODO lesson 2: the stubs below don't use their parameters yet. Delete this line when you're done.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { generateKeyBetween } from "fractional-indexing";
import type { BoardState } from "./types.js";

/** A key that sorts strictly between `before` and `after` (null = open end). D5. */
export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/**
 * Sort by (order, id) with plain code-unit comparison.
 * Never use localeCompare here: fractional keys rely on byte order, and the id
 * tie-break is what makes two cards with the same key sort the same way everywhere (C8).
 */
// TODO lesson 2: a comparator for Array.prototype.sort. Each entry is [id, { order }].
function byOrderThenId(a: [string, { order: string }], b: [string, { order: string }]): number {
  throw new Error("TODO lesson 2: byOrderThenId");
}

export function sortedColumnIds(state: BoardState): string[] {
  return Object.entries(state.columns)
    .filter(([, c]) => !c.deleted)
    .sort(byOrderThenId)
    .map(([id]) => id);
}

export function sortedCardIds(state: BoardState, columnId: string): string[] {
  return Object.entries(state.cards)
    .filter(([, c]) => c.columnId === columnId && !c.deleted)
    .sort(byOrderThenId)
    .map(([id]) => id);
}

/**
 * The order key that places an item at `index` among `ids` (sorted, without the item itself).
 * If the neighbours share a key (a C8 tie), there's no key strictly between them, so we step
 * past the tie. The item then lands just after the tied group: close, and the same everywhere.
 */
// TODO lesson 2: use keyBetween(before, after). Careful: keyBetween throws if before >= after.
function orderAt(ids: string[], orderOf: (id: string) => string, index: number): string {
  throw new Error("TODO lesson 2: orderAt");
}

/** Order key for putting `cardId` at position `index` of `columnId` (0 = top). */
export function cardOrderAt(state: BoardState, columnId: string, index: number, cardId?: string): string {
  const ids = sortedCardIds(state, columnId).filter((id) => id !== cardId);
  return orderAt(ids, (id) => state.cards[id]!.order, Math.max(0, Math.min(index, ids.length)));
}

/** Order key for putting `columnId` at position `index` among columns (0 = left). */
export function columnOrderAt(state: BoardState, index: number, columnId?: string): string {
  const ids = sortedColumnIds(state).filter((id) => id !== columnId);
  return orderAt(ids, (id) => state.columns[id]!.order, Math.max(0, Math.min(index, ids.length)));
}
