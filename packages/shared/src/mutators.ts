// TODO lesson 1: the stubs below don't use their parameters yet. Delete this line when you're done,
// then `pnpm lint` must pass too.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { parseIntent, type IntentArgs, type IntentName } from "./intents.js";
import type {
  BoardState,
  CardValue,
  Change,
  ColumnValue,
  MutationContext,
  MutationResult,
  RejectCode,
} from "./types.js";

/**
 * Pure functions: (state, args) -> changes or a reject code.
 * The client runs them to predict (optimistic update), the server runs them to decide (D4).
 * They never mutate `state`.
 */
type Mutator<N extends IntentName> = (state: BoardState, args: IntentArgs<N>) => MutationResult;

const reject = (code: RejectCode, message?: string): MutationResult =>
  message === undefined ? { ok: false, code } : { ok: false, code, message };

const ok = (...changes: Change[]): MutationResult => ({ ok: true, changes });

const card = (id: string, value: CardValue): Change => ({ kind: "card", id, value });
const column = (id: string, value: ColumnValue): Change => ({ kind: "column", id, value });

/** R9: every field the caller expects must still hold. */
function matches<T extends object>(
  current: T,
  expect: { [K in keyof T]?: T[K] | undefined } | undefined,
): boolean {
  if (!expect) return true;
  return (Object.keys(expect) as (keyof T)[]).every(
    (key) => expect[key] === undefined || current[key] === expect[key],
  );
}

function liveCardCount(state: BoardState, columnId: string, excludeCardId?: string): number {
  let count = 0;
  for (const [id, c] of Object.entries(state.cards)) {
    if (c.columnId === columnId && !c.deleted && id !== excludeCardId) count++;
  }
  return count;
}

/**
 * R2 + R3: can `cardId` be live in `columnId`? Returns a reject code, or null if it can.
 * Used by createCard, moveCard and restoreCard.
 *
 * TODO lesson 1. Think about: what if the column doesn't exist? Is deleted? Is full?
 * And: when a card is moved *within* a full column, should it count itself?
 */
function checkTarget(state: BoardState, columnId: string, cardId: string): RejectCode | null {
  throw new Error("TODO lesson 1: checkTarget");
}

const mutators: { [N in IntentName]: Mutator<N> } = {
  createCard(state, { cardId, columnId, order }) {
    if (state.cards[cardId]) return reject("INVALID", `card ${cardId} already exists`);
    const problem = checkTarget(state, columnId, cardId);
    if (problem) return reject(problem);
    return ok(card(cardId, { columnId, order, deleted: false }));
  },

  // TODO lesson 1. Rules: R2, R3, R6, R7 (unknown card), R9 (`expect`).
  // The order of the checks matters: the tests expect a specific code when several rules fail.
  // Look at deleteCard below for the shape.
  moveCard(state, { cardId, columnId, order, expect }) {
    throw new Error("TODO lesson 1: moveCard");
  },

  deleteCard(state, { cardId, expect }) {
    const current = state.cards[cardId];
    if (!current) return reject("INVALID", `unknown card ${cardId}`);
    if (!matches(current, expect)) return reject("STALE");
    if (current.deleted) return ok(); // concurrent double delete: both succeed
    return ok(card(cardId, { ...current, deleted: true }));
  },

  restoreCard(state, { cardId, expect }) {
    const current = state.cards[cardId];
    if (!current) return reject("INVALID", `unknown card ${cardId}`);
    if (!matches(current, expect)) return reject("STALE");
    if (!current.deleted) return ok();
    const problem = checkTarget(state, current.columnId, cardId);
    if (problem) return reject(problem);
    return ok(card(cardId, { ...current, deleted: false }));
  },

  createColumn(state, { columnId, order, wipLimit = null }) {
    if (state.columns[columnId]) return reject("INVALID", `column ${columnId} already exists`);
    return ok(column(columnId, { order, wipLimit, deleted: false }));
  },

  moveColumn(state, { columnId, order, expect }) {
    const current = state.columns[columnId];
    if (!current) return reject("INVALID", `unknown column ${columnId}`);
    if (!matches(current, expect)) return reject("STALE");
    if (current.deleted) return reject("COLUMN_DELETED");
    return ok(column(columnId, { ...current, order }));
  },

  // TODO lesson 1. Rules: R4, R7, R9. What should deleting an already-deleted column do? (Hint: C9,
  // and think about two people pressing "Delete column" at the same moment.)
  deleteColumn(state, { columnId, expect }) {
    throw new Error("TODO lesson 1: deleteColumn");
  },

  /** Undo of deleteColumn, redo of createColumn (M6). */
  restoreColumn(state, { columnId, expect }) {
    const current = state.columns[columnId];
    if (!current) return reject("INVALID", `unknown column ${columnId}`);
    if (!matches(current, expect)) return reject("STALE");
    if (!current.deleted) return ok();
    return ok(column(columnId, { ...current, deleted: false }));
  },

  // TODO lesson 1. Rules: R5, R7, R9, and "a deleted column can't be changed". `null` means no limit.
  setWipLimit(state, { columnId, wipLimit, expect }) {
    throw new Error("TODO lesson 1: setWipLimit");
  },
};

/**
 * Single entry point for both client and server.
 * `raw` is untrusted (it may come off the wire), so it is validated first (R7).
 */
export function runIntent(state: BoardState, raw: unknown, ctx: MutationContext): MutationResult {
  if (ctx.role !== "editor") return reject("FORBIDDEN"); // R1
  const parsed = parseIntent(raw);
  if (!parsed.ok) return reject("INVALID", parsed.message);
  const { name, args } = parsed.intent;
  return mutators[name](state, args as never);
}

/** Apply accepted changes. Returns a new state; the input is left untouched. */
export function applyChanges(state: BoardState, changes: readonly Change[]): BoardState {
  if (changes.length === 0) return state;
  const next: BoardState = { columns: { ...state.columns }, cards: { ...state.cards } };
  for (const change of changes) {
    if (change.kind === "card") next.cards[change.id] = change.value;
    else next.columns[change.id] = change.value;
  }
  return next;
}
