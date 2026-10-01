import { describe, expect, it } from "vitest";
import {
  applyChanges,
  cardOrderAt,
  columnOrderAt,
  runIntent,
  sortedCardIds,
  sortedColumnIds,
  type BoardState,
} from "../src/index.js";
import { board, editor } from "./fixtures.js";

function moveTo(state: BoardState, cardId: string, columnId: string, index: number): BoardState {
  const order = cardOrderAt(state, columnId, index, cardId);
  const result = runIntent(state, { name: "moveCard", args: { cardId, columnId, order } }, editor);
  if (!result.ok) throw new Error(result.code);
  return applyChanges(state, result.changes);
}

describe("cardOrderAt", () => {
  it("places a card at the top, middle, and bottom of another column", () => {
    let state = board(); // todo: a1, a2
    state = moveTo(state, "b1", "todo", 0);
    expect(sortedCardIds(state, "todo")).toEqual(["b1", "a1", "a2"]);
    state = moveTo(state, "b1", "todo", 2);
    expect(sortedCardIds(state, "todo")).toEqual(["a1", "a2", "b1"]);
    state = moveTo(state, "b1", "todo", 1);
    expect(sortedCardIds(state, "todo")).toEqual(["a1", "b1", "a2"]);
  });

  it("moves a card down and up within its own column", () => {
    let state = moveTo(board(), "b1", "todo", 2); // a1, a2, b1
    state = moveTo(state, "a1", "todo", 1); // one step down
    expect(sortedCardIds(state, "todo")).toEqual(["a2", "a1", "b1"]);
    state = moveTo(state, "b1", "todo", 0);
    expect(sortedCardIds(state, "todo")).toEqual(["b1", "a2", "a1"]);
  });

  it("clamps out-of-range indexes", () => {
    expect(sortedCardIds(moveTo(board(), "b1", "todo", 99), "todo")).toEqual(["a1", "a2", "b1"]);
    expect(sortedCardIds(moveTo(board(), "b1", "todo", -5), "todo")).toEqual(["b1", "a1", "a2"]);
  });

  it("steps past a tie instead of throwing (C8)", () => {
    const state = board();
    state.cards = {
      t1: { columnId: "done", order: "a0", deleted: false },
      t2: { columnId: "done", order: "a0", deleted: false },
      t3: { columnId: "done", order: "a1", deleted: false },
      x: { columnId: "todo", order: "a0", deleted: false },
    };
    const next = moveTo(state, "x", "done", 1); // "between" t1 and t2, which share a key
    expect(sortedCardIds(next, "done")).toEqual(["t1", "t2", "x", "t3"]);
  });
});

describe("columnOrderAt", () => {
  it("reorders columns", () => {
    const state = board(); // todo, doing, done
    const order = columnOrderAt(state, 0, "done");
    const result = runIntent(state, { name: "moveColumn", args: { columnId: "done", order } }, editor);
    if (!result.ok) throw new Error(result.code);
    expect(sortedColumnIds(applyChanges(state, result.changes))).toEqual(["done", "todo", "doing"]);
  });
});
