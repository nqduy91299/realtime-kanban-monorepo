// TODO lesson 8: the stubs below don't use their parameters yet. Delete these two lines when you're done.
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  applyChanges,
  cardOrderAt,
  columnOrderAt,
  sortedCardIds,
  sortedColumnIds,
  type BoardState,
  type IntentArgs,
} from "@kanban/shared";

/**
 * Drag and drop as a pure state machine (K2–K8). The keyboard and the pointer both drive it,
 * so a drag behaves the same however it's done (K11). Nothing here touches the server: while
 * dragging, the UI renders `previewBoard()`, and only the drop produces a single intent (K5).
 */

export interface Slot {
  columnId: string;
  /** Position among the column's other cards (the dragged card itself excluded). */
  index: number;
}

export interface CardDrag {
  kind: "card";
  cardId: string;
  origin: Slot;
  target: Slot;
}

export interface ColumnDrag {
  kind: "column";
  columnId: string;
  origin: number;
  target: number;
}

export type Drag = CardDrag | ColumnDrag;
export type Direction = "up" | "down" | "left" | "right";

/** Where a card currently is. Null if it isn't on the board (e.g. deleted). */
export function slotOf(board: BoardState, cardId: string): Slot | null {
  const card = board.cards[cardId];
  if (!card || card.deleted) return null;
  return { columnId: card.columnId, index: sortedCardIds(board, card.columnId).indexOf(cardId) };
}

export function startCardDrag(board: BoardState, cardId: string): CardDrag | null {
  const origin = slotOf(board, cardId);
  return origin ? { kind: "card", cardId, origin, target: origin } : null;
}

export function startColumnDrag(board: BoardState, columnId: string): ColumnDrag | null {
  const index = sortedColumnIds(board).indexOf(columnId);
  return index < 0 ? null : { kind: "column", columnId, origin: index, target: index };
}

/** How many other cards a column has, i.e. the largest valid index. */
function othersIn(board: BoardState, columnId: string, cardId: string): number {
  return sortedCardIds(board, columnId).filter((id) => id !== cardId).length;
}

/** One arrow key press. ↑/↓ within the column (K3); ←/→ to the next column, index clamped (K4). */
export function moveDrag<D extends Drag>(board: BoardState, drag: D, direction: Direction): D {
  // TODO lesson 8: one arrow press. Return a new drag; never mutate the old one
  throw new Error("TODO lesson 8: moveDrag");
}

/** Set the target directly (pointer dragging). */
export function retarget(drag: CardDrag, target: Slot): CardDrag {
  return target.columnId === drag.target.columnId && target.index === drag.target.index
    ? drag
    : { ...drag, target };
}

/** The board as it would look if dropped now. Local only, never sent. */
export function previewBoard(board: BoardState, drag: Drag | null): BoardState {
  // TODO lesson 8: the board as it would look if dropped now (local only)
  throw new Error("TODO lesson 8: previewBoard");
}

function isHome(drag: CardDrag): boolean {
  return drag.target.columnId === drag.origin.columnId && drag.target.index === drag.origin.index;
}

/** The single intent a drop produces (K5), or null if it ends where it started. */
export function dropCard(board: BoardState, drag: CardDrag): IntentArgs<"moveCard"> | null {
  // TODO lesson 8: the single moveCard intent's args, or null if it ends where it started
  throw new Error("TODO lesson 8: dropCard");
}

export function dropColumn(board: BoardState, drag: ColumnDrag): IntentArgs<"moveColumn"> | null {
  // TODO lesson 8: the same for a column
  throw new Error("TODO lesson 8: dropColumn");
}

/* ---------- what a screen reader hears (K2–K6) ---------- */

export interface Names {
  card(cardId: string): string;
  column(columnId: string): string;
}

/** "position 2 of 5 in To do". Counts include the dragged card, as a sighted user would see it. */
function where(board: BoardState, drag: CardDrag, names: Names): string {
  const { columnId, index } = drag.target;
  const total = othersIn(board, columnId, drag.cardId) + 1;
  return `position ${index + 1} of ${total} in ${names.column(columnId)}`;
}

function fullNote(board: BoardState, drag: CardDrag, names: Names): string {
  const { columnId } = drag.target;
  const limit = board.columns[columnId]?.wipLimit ?? null;
  if (limit === null || columnId === drag.origin.columnId) return "";
  return othersIn(board, columnId, drag.cardId) >= limit
    ? ` ${names.column(columnId)} is full (limit ${limit}), so the card can't be dropped here.`
    : "";
}

export const announce = {
  pickedUp(board: BoardState, drag: Drag, names: Names): string {
    if (drag.kind === "column") {
      const total = sortedColumnIds(board).length;
      return `Picked up column ${names.column(drag.columnId)}. Position ${drag.origin + 1} of ${total}. Left and right arrows to move, Space to drop, Escape to cancel.`;
    }
    return `Picked up ${names.card(drag.cardId)}. ${capitalize(where(board, drag, names))}. Arrow keys to move, Space to drop, Escape to cancel.`;
  },

  moved(board: BoardState, before: Drag, after: Drag, names: Names): string {
    if (after.kind === "column") {
      const total = sortedColumnIds(board).length;
      return before.kind === "column" && before.target === after.target
        ? `Can't move further. Position ${after.target + 1} of ${total}.`
        : `Position ${after.target + 1} of ${total}.`;
    }
    const prev = before as CardDrag;
    if (prev.target.columnId === after.target.columnId && prev.target.index === after.target.index) {
      return `Can't move further. ${capitalize(where(board, after, names))}.`;
    }
    if (prev.target.columnId !== after.target.columnId) {
      const total = othersIn(board, after.target.columnId, after.cardId) + 1;
      return `Moved to ${names.column(after.target.columnId)}, position ${after.target.index + 1} of ${total}.${fullNote(board, after, names)}`;
    }
    return `${capitalize(where(board, after, names))}.`;
  },

  dropped(board: BoardState, drag: Drag, names: Names): string {
    if (drag.kind === "column") {
      return `Dropped column ${names.column(drag.columnId)} at position ${drag.target + 1} of ${sortedColumnIds(board).length}.`;
    }
    return `Dropped ${names.card(drag.cardId)} at ${where(board, drag, names)}.`;
  },

  cancelled(board: BoardState, drag: Drag, names: Names): string {
    if (drag.kind === "column")
      return `Cancelled. Column ${names.column(drag.columnId)} returned to position ${drag.origin + 1}.`;
    const home: CardDrag = { ...drag, target: drag.origin };
    return `Cancelled. ${names.card(drag.cardId)} returned to ${where(board, home, names)}.`;
  },
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
