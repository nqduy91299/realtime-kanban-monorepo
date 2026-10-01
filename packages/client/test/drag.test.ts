import { describe, expect, it } from "vitest";
import { sortedCardIds, sortedColumnIds, type BoardState } from "@kanban/shared";
import {
  announce,
  dropCard,
  dropColumn,
  moveDrag,
  previewBoard,
  startCardDrag,
  startColumnDrag,
  type Direction,
  type Drag,
} from "../src/index.js";

/** todo: a, b, c · doing (limit 2): d · done: empty */
function board(): BoardState {
  return {
    columns: {
      todo: { order: "a0", wipLimit: null, deleted: false },
      doing: { order: "a1", wipLimit: 2, deleted: false },
      done: { order: "a2", wipLimit: null, deleted: false },
    },
    cards: {
      a: { columnId: "todo", order: "a0", deleted: false },
      b: { columnId: "todo", order: "a1", deleted: false },
      c: { columnId: "todo", order: "a2", deleted: false },
      d: { columnId: "doing", order: "a0", deleted: false },
    },
  };
}

const names = {
  card: (id: string) => `Card ${id.toUpperCase()}`,
  column: (id: string) => ({ todo: "To do", doing: "Doing", done: "Done" })[id] ?? id,
};

function press<D extends Drag>(b: BoardState, drag: D, ...keys: Direction[]): D {
  return keys.reduce((d, key) => moveDrag(b, d, key), drag);
}

describe("K2 picking up a card", () => {
  it("starts where the card is and says so", () => {
    const drag = startCardDrag(board(), "b")!;
    expect(drag.origin).toEqual({ columnId: "todo", index: 1 });
    expect(announce.pickedUp(board(), drag, names)).toBe(
      "Picked up Card B. Position 2 of 3 in To do. Arrow keys to move, Space to drop, Escape to cancel.",
    );
  });

  it("can't pick up a card that isn't on the board", () => {
    const b = board();
    b.cards.a!.deleted = true;
    expect(startCardDrag(b, "a")).toBeNull();
    expect(startCardDrag(b, "zzz")).toBeNull();
  });
});

describe("K3 up and down within the column", () => {
  it("moves one step at a time and stops at the ends", () => {
    const b = board();
    const start = startCardDrag(b, "a")!;
    const down = press(b, start, "down");
    expect(down.target).toEqual({ columnId: "todo", index: 1 });
    expect(announce.moved(b, start, down, names)).toBe("Position 2 of 3 in To do.");

    const bottom = press(b, start, "down", "down", "down", "down");
    expect(bottom.target.index).toBe(2);
    expect(announce.moved(b, press(b, start, "down", "down"), bottom, names)).toBe(
      "Can't move further. Position 3 of 3 in To do.",
    );
    expect(press(b, start, "up").target.index).toBe(0);
  });

  it("the preview shows the new order without touching the real board", () => {
    const b = board();
    const drag = press(b, startCardDrag(b, "a")!, "down", "down");
    expect(sortedCardIds(previewBoard(b, drag), "todo")).toEqual(["b", "c", "a"]);
    expect(sortedCardIds(b, "todo")).toEqual(["a", "b", "c"]);
  });
});

describe("K4 left and right to the next column", () => {
  it("keeps the row when it can, clamps when the column is shorter", () => {
    const b = board();
    const drag = press(b, startCardDrag(b, "c")!, "right"); // row 3 → Doing has 1 other card
    expect(drag.target).toEqual({ columnId: "doing", index: 1 });
    expect(announce.moved(b, startCardDrag(b, "c")!, drag, names)).toBe("Moved to Doing, position 2 of 2.");
    expect(press(b, drag, "right").target).toEqual({ columnId: "done", index: 0 });
    expect(press(b, drag, "right", "right").target.columnId).toBe("done"); // no column further right
    expect(press(b, startCardDrag(b, "a")!, "left").target.columnId).toBe("todo");
  });

  it("warns when the column it's over is full", () => {
    const b = board();
    b.columns.doing!.wipLimit = 1;
    const start = startCardDrag(b, "a")!;
    const over = press(b, start, "right");
    expect(announce.moved(b, start, over, names)).toBe(
      "Moved to Doing, position 1 of 2. Doing is full (limit 1), so the card can't be dropped here.",
    );
  });
});

describe("K5 dropping", () => {
  it("any number of arrow presses make exactly one intent", () => {
    const b = board();
    const drag = press(b, startCardDrag(b, "a")!, "down", "right", "right", "up", "down");
    const intent = dropCard(b, drag)!;
    expect(intent.cardId).toBe("a");
    expect(intent.columnId).toBe("done");
    expect(announce.dropped(b, drag, names)).toBe("Dropped Card A at position 1 of 1 in Done.");
  });

  it("dropping where it started sends nothing", () => {
    const b = board();
    expect(dropCard(b, press(b, startCardDrag(b, "a")!, "down", "up"))).toBeNull();
  });

  it("the intent's order puts the card exactly where the preview showed it", () => {
    const b = board();
    const drag = press(b, startCardDrag(b, "d")!, "left", "down"); // into To do, row 2
    const intent = dropCard(b, drag)!;
    const after = { ...b, cards: { ...b.cards, d: { ...b.cards.d!, columnId: intent.columnId, order: intent.order } } };
    expect(sortedCardIds(after, "todo")).toEqual(sortedCardIds(previewBoard(b, drag), "todo"));
    expect(sortedCardIds(after, "todo")).toEqual(["a", "d", "b", "c"]);
  });
});

describe("K6 cancelling", () => {
  it("says where the card went back to", () => {
    const b = board();
    const drag = press(b, startCardDrag(b, "b")!, "right");
    expect(announce.cancelled(b, drag, names)).toBe("Cancelled. Card B returned to position 2 of 3 in To do.");
  });
});

describe("K8 columns", () => {
  it("left/right reorder columns; up/down do nothing", () => {
    const b = board();
    const start = startColumnDrag(b, "done")!;
    const drag = press(b, start, "left", "left", "left", "up");
    expect(drag.target).toBe(0);
    expect(sortedColumnIds(previewBoard(b, drag))).toEqual(["done", "todo", "doing"]);
    expect(dropColumn(b, drag)?.columnId).toBe("done");
    expect(dropColumn(b, start)).toBeNull();
    expect(announce.pickedUp(b, start, names)).toBe(
      "Picked up column Done. Position 3 of 3. Left and right arrows to move, Space to drop, Escape to cancel.",
    );
  });
});
