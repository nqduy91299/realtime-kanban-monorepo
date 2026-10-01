import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyChanges,
  cardOrderAt,
  columnOrderAt,
  runIntent,
  sortedCardIds,
  sortedColumnIds,
  type BoardState,
  type IntentBody,
} from "@kanban/shared";
import { invertIntent } from "../src/index.js";

const editor = { role: "editor" } as const;

/** todo: a, b · doing (limit 3): c · done: empty · old: deleted column · x: deleted card */
function board(): BoardState {
  return {
    columns: {
      todo: { order: "a0", wipLimit: null, deleted: false },
      doing: { order: "a1", wipLimit: 3, deleted: false },
      done: { order: "a2", wipLimit: null, deleted: false },
      old: { order: "a3", wipLimit: null, deleted: true },
    },
    cards: {
      a: { columnId: "todo", order: "a0", deleted: false },
      b: { columnId: "todo", order: "a1", deleted: false },
      c: { columnId: "doing", order: "a0", deleted: false },
      x: { columnId: "todo", order: "a2", deleted: true },
    },
  };
}

function apply(state: BoardState, intent: IntentBody): BoardState | null {
  const result = runIntent(state, intent, editor);
  return result.ok ? applyChanges(state, result.changes) : null;
}

/** What a person sees: column order, each column's limit and cards in order. */
function visible(state: BoardState) {
  return sortedColumnIds(state).map((id) => [id, state.columns[id]!.wipLimit, sortedCardIds(state, id)]);
}

describe("invertIntent", () => {
  const step = fc.oneof(
    fc.record({ name: fc.constant("moveCard" as const), card: fc.constantFrom("a", "b", "c"), column: fc.constantFrom("todo", "doing", "done"), index: fc.nat(3) }),
    fc.record({ name: fc.constant("createCard" as const), column: fc.constantFrom("todo", "doing", "done"), index: fc.nat(3) }),
    fc.record({ name: fc.constant("deleteCard" as const), card: fc.constantFrom("a", "b", "c", "x") }),
    fc.record({ name: fc.constant("restoreCard" as const), card: fc.constantFrom("a", "x") }),
    fc.record({ name: fc.constant("createColumn" as const), index: fc.nat(4) }),
    fc.record({ name: fc.constant("moveColumn" as const), column: fc.constantFrom("todo", "doing", "done"), index: fc.nat(3) }),
    fc.record({ name: fc.constant("deleteColumn" as const), column: fc.constantFrom("done", "old", "todo") }),
    fc.record({ name: fc.constant("restoreColumn" as const), column: fc.constantFrom("old", "done") }),
    fc.record({ name: fc.constant("setWipLimit" as const), column: fc.constantFrom("todo", "doing"), limit: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }) }),
  );

  type Step = typeof step extends fc.Arbitrary<infer T> ? T : never;

  function build(state: BoardState, s: Step, n: number): IntentBody {
    switch (s.name) {
      case "moveCard":
        return { name: "moveCard", args: { cardId: s.card, columnId: s.column, order: cardOrderAt(state, s.column, s.index, s.card) } };
      case "createCard":
        return { name: "createCard", args: { cardId: `new${n}`, columnId: s.column, order: cardOrderAt(state, s.column, s.index) } };
      case "deleteCard":
      case "restoreCard":
        return { name: s.name, args: { cardId: s.card } };
      case "createColumn":
        return { name: "createColumn", args: { columnId: `col${n}`, order: columnOrderAt(state, s.index) } };
      case "moveColumn":
        return { name: "moveColumn", args: { columnId: s.column, order: columnOrderAt(state, s.index, s.column) } };
      case "deleteColumn":
      case "restoreColumn":
        return { name: s.name, args: { columnId: s.column } };
      default:
        return { name: "setWipLimit", args: { columnId: s.column, wipLimit: s.limit } };
    }
  }

  it("undo brings back exactly what you saw before; redo what you saw after (property)", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 8 }), (steps) => {
        let state = board();
        steps.forEach((s, n) => {
          const intent = build(state, s, n);
          const after = apply(state, intent);
          if (!after) return; // invalid on this board (e.g. WIP limit): nothing to undo
          const inverse = invertIntent(state, intent);
          if (!inverse) {
            expect(visible(after)).toEqual(visible(state)); // null only for changes that did nothing visible
          } else {
            const undone = apply(after, inverse.undo);
            expect(undone).not.toBeNull();
            expect(visible(undone!)).toEqual(visible(state));
            const redone = apply(undone!, inverse.redo);
            expect(redone).not.toBeNull();
            expect(visible(redone!)).toEqual(visible(after));
          }
          state = after;
        });
      }),
      { numRuns: 500 },
    );
  });

  it("U4: undo is refused (STALE) if someone changed the card after you", () => {
    const before = board();
    const mine: IntentBody = { name: "moveCard", args: { cardId: "a", columnId: "doing", order: "a5" } };
    const afterMine = apply(before, mine)!;
    const theirs = apply(afterMine, { name: "moveCard", args: { cardId: "a", columnId: "done", order: "a0" } })!;
    const { undo } = invertIntent(before, mine)!;
    expect(runIntent(theirs, undo, editor)).toEqual({ ok: false, code: "STALE" });
    // Someone else moving a *different* card doesn't block it.
    const unrelated = apply(afterMine, { name: "moveCard", args: { cardId: "b", columnId: "done", order: "a0" } })!;
    expect(runIntent(unrelated, undo, editor).ok).toBe(true);
  });

  it("returns null for changes that did nothing", () => {
    expect(invertIntent(board(), { name: "deleteCard", args: { cardId: "x" } })).toBeNull();
    expect(invertIntent(board(), { name: "restoreCard", args: { cardId: "a" } })).toBeNull();
    expect(invertIntent(board(), { name: "setWipLimit", args: { columnId: "doing", wipLimit: 3 } })).toBeNull();
  });
});
