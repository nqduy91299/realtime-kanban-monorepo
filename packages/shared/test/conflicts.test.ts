import { describe, expect, it } from "vitest";
import { keyBetween, sortedCardIds, sortedColumnIds, type BoardState } from "../src/index.js";
import { apply, board, codeOf } from "./fixtures.js";

/** Process intents in the given (server) order. */
function serverOrder(state: BoardState, intents: unknown[]): BoardState {
  return intents.reduce<BoardState>((s, intent) => apply(s, intent).state, state);
}

describe("C4 concurrent moves of the same card", () => {
  const toDoing = { name: "moveCard", args: { cardId: "a1", columnId: "doing", order: "a1" } };
  const toDone = { name: "moveCard", args: { cardId: "a1", columnId: "done", order: "a0" } };

  it("the later-processed move wins", () => {
    expect(serverOrder(board(), [toDoing, toDone]).cards.a1?.columnId).toBe("done");
    expect(serverOrder(board(), [toDone, toDoing]).cards.a1?.columnId).toBe("doing");
  });

  it("the card is never duplicated or lost", () => {
    for (const order of [
      [toDoing, toDone],
      [toDone, toDoing],
    ]) {
      const state = serverOrder(board(), order);
      const everywhere = sortedColumnIds(state).flatMap((col) => sortedCardIds(state, col));
      expect(everywhere.filter((id) => id === "a1")).toHaveLength(1);
      expect(everywhere).toHaveLength(3); // a1, a2, b1
    }
  });
});

describe("C8 two cards inserted at the same slot", () => {
  it("both exist and sort by id when keys tie, whatever the arrival order", () => {
    // Alice and Bob both compute keyBetween(a1, a2) offline, so they get the same key.
    const key = keyBetween("a0", "a1");
    const alice = { name: "createCard", args: { cardId: "card-alice", columnId: "todo", order: key } };
    const bob = { name: "createCard", args: { cardId: "card-bob", columnId: "todo", order: key } };

    const one = sortedCardIds(serverOrder(board(), [alice, bob]), "todo");
    const two = sortedCardIds(serverOrder(board(), [bob, alice]), "todo");

    expect(one).toEqual(["a1", "card-alice", "card-bob", "a2"]);
    expect(two).toEqual(one);
  });

  it("sorting uses byte order, not locale order", () => {
    // "B" < "a" in byte order; localeCompare would put "a" first.
    const state = board();
    state.cards = {
      lower: { columnId: "done", order: "a0", deleted: false },
      upper: { columnId: "done", order: "Zz", deleted: false },
    };
    expect(sortedCardIds(state, "done")).toEqual(["upper", "lower"]);
  });
});

describe("C9 delete an empty column vs move a card into it", () => {
  const del = { name: "deleteColumn", args: { columnId: "done" } };
  const move = { name: "moveCard", args: { cardId: "a1", columnId: "done", order: "a0" } };

  it("delete first → the move is rejected", () => {
    const afterDelete = apply(board(), del).state;
    expect(codeOf(apply(afterDelete, move).result)).toBe("COLUMN_DELETED");
  });
  it("move first → the delete is rejected", () => {
    const afterMove = apply(board(), move).state;
    expect(codeOf(apply(afterMove, del).result)).toBe("COLUMN_NOT_EMPTY");
  });
});

describe("C10 two moves into a column with one free slot", () => {
  it("the first is accepted, the second is rejected", () => {
    const first = apply(board(), {
      name: "moveCard",
      args: { cardId: "a1", columnId: "doing", order: "a1" },
    });
    const second = apply(first.state, {
      name: "moveCard",
      args: { cardId: "a2", columnId: "doing", order: "a2" },
    });
    expect([codeOf(first.result), codeOf(second.result)]).toEqual(["OK", "WIP_LIMIT"]);
  });
});

describe("C11 concurrent reorders of the same column", () => {
  it("the later-processed reorder wins", () => {
    const first = { name: "moveColumn", args: { columnId: "done", order: "Zz" } }; // to the front
    const second = { name: "moveColumn", args: { columnId: "done", order: "a0V" } }; // between todo and doing
    expect(sortedColumnIds(serverOrder(board(), [first, second]))).toEqual(["todo", "done", "doing"]);
    expect(sortedColumnIds(serverOrder(board(), [second, first]))).toEqual(["done", "todo", "doing"]);
  });
});

describe("C12 WIP limit change vs a move into the column", () => {
  const lower = { name: "setWipLimit", args: { columnId: "doing", wipLimit: 1 } };
  const move = { name: "moveCard", args: { cardId: "a1", columnId: "doing", order: "a1" } };

  it("limit first → the move is rejected", () => {
    expect(codeOf(apply(apply(board(), lower).state, move).result)).toBe("WIP_LIMIT");
  });
  it("move first → the limit change is rejected", () => {
    expect(codeOf(apply(apply(board(), move).state, lower).result)).toBe("WIP_BELOW_COUNT");
  });
});

describe("keyBetween", () => {
  it("always sorts strictly between its neighbours", () => {
    let lo = "a0";
    const hi = "a1";
    for (let i = 0; i < 50; i++) {
      const mid = keyBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      lo = mid;
    }
  });
});
