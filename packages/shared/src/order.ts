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
function byOrderThenId(a: [string, { order: string }], b: [string, { order: string }]): number {
  if (a[1].order !== b[1].order) return a[1].order < b[1].order ? -1 : 1;
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
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
function orderAt(ids: string[], orderOf: (id: string) => string, index: number): string {
  const before = index > 0 ? orderOf(ids[index - 1]!) : null;
  let next = index;
  while (next < ids.length && before !== null && orderOf(ids[next]!) <= before) next++;
  const after = next < ids.length ? orderOf(ids[next]!) : null;
  return keyBetween(before, after);
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
