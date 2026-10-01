import { describe, expect, it } from "vitest";
import { runIntent } from "../src/index.js";
import { apply, board, codeOf, editor, viewer } from "./fixtures.js";

const run = (intent: unknown) => codeOf(runIntent(board(), intent, editor));

describe("R1 viewers can't write", () => {
  const intents = [
    { name: "createCard", args: { cardId: "n1", columnId: "todo", order: "a5" } },
    { name: "moveCard", args: { cardId: "a1", columnId: "done", order: "a0" } },
    { name: "deleteCard", args: { cardId: "a1" } },
    { name: "restoreCard", args: { cardId: "x9" } },
    { name: "createColumn", args: { columnId: "c9", order: "a9" } },
    { name: "moveColumn", args: { columnId: "done", order: "Zz" } },
    { name: "deleteColumn", args: { columnId: "done" } },
    { name: "restoreColumn", args: { columnId: "old" } },
    { name: "setWipLimit", args: { columnId: "todo", wipLimit: 5 } },
  ];
  it.each(intents)("$name → FORBIDDEN", (intent) => {
    expect(codeOf(runIntent(board(), intent, viewer))).toBe("FORBIDDEN");
    expect(codeOf(runIntent(board(), intent, editor))).toBe("OK");
  });

  it("rejects garbage from a viewer as FORBIDDEN, without revealing validation details", () => {
    expect(codeOf(runIntent(board(), { name: "nope" }, viewer))).toBe("FORBIDDEN");
  });
});

describe("R2 a card must be in a live column", () => {
  it("createCard into a deleted column", () => {
    expect(run({ name: "createCard", args: { cardId: "n1", columnId: "old", order: "a0" } })).toBe(
      "COLUMN_DELETED",
    );
  });
  it("moveCard into a deleted column", () => {
    expect(run({ name: "moveCard", args: { cardId: "a1", columnId: "old", order: "a0" } })).toBe(
      "COLUMN_DELETED",
    );
  });
  it("restoreCard whose column was deleted meanwhile", () => {
    const state = board();
    state.cards.x9 = { columnId: "old", order: "a0", deleted: true };
    expect(codeOf(runIntent(state, { name: "restoreCard", args: { cardId: "x9" } }, editor))).toBe(
      "COLUMN_DELETED",
    );
  });
});

describe("R3 WIP limit is a hard block", () => {
  // doing has limit 2 and holds b1
  it("accepts up to the limit, then rejects", () => {
    const first = apply(board(), {
      name: "moveCard",
      args: { cardId: "a1", columnId: "doing", order: "a1" },
    });
    expect(codeOf(first.result)).toBe("OK");
    const second = apply(first.state, {
      name: "moveCard",
      args: { cardId: "a2", columnId: "doing", order: "a2" },
    });
    expect(codeOf(second.result)).toBe("WIP_LIMIT");
  });

  it("applies to createCard and restoreCard too", () => {
    const full = apply(board(), {
      name: "createCard",
      args: { cardId: "n1", columnId: "doing", order: "a1" },
    }).state;
    expect(
      codeOf(
        runIntent(
          full,
          { name: "createCard", args: { cardId: "n2", columnId: "doing", order: "a2" } },
          editor,
        ),
      ),
    ).toBe("WIP_LIMIT");

    full.cards.x9 = { columnId: "doing", order: "a3", deleted: true };
    expect(codeOf(runIntent(full, { name: "restoreCard", args: { cardId: "x9" } }, editor))).toBe(
      "WIP_LIMIT",
    );
  });

  it("reordering inside a full column is allowed (the card is already counted)", () => {
    const state = board();
    state.columns.doing!.wipLimit = 1;
    expect(
      codeOf(
        runIntent(
          state,
          { name: "moveCard", args: { cardId: "b1", columnId: "doing", order: "Zz" } },
          editor,
        ),
      ),
    ).toBe("OK");
  });

  it("deleted cards don't count", () => {
    const state = board();
    state.cards.x9 = { columnId: "doing", order: "a5", deleted: true };
    expect(
      codeOf(
        runIntent(
          state,
          { name: "moveCard", args: { cardId: "a1", columnId: "doing", order: "a1" } },
          editor,
        ),
      ),
    ).toBe("OK");
  });

  it("null means unlimited", () => {
    let state = board();
    for (let i = 0; i < 20; i++) {
      state = apply(state, {
        name: "createCard",
        args: { cardId: `n${i}`, columnId: "done", order: `a${i}` },
      }).state;
    }
    expect(Object.values(state.cards).filter((c) => c.columnId === "done")).toHaveLength(20);
  });
});

describe("R4 only empty columns can be deleted", () => {
  it("rejects a column with live cards", () => {
    expect(run({ name: "deleteColumn", args: { columnId: "doing" } })).toBe("COLUMN_NOT_EMPTY");
  });
  it("allows a column holding only deleted cards", () => {
    const state = board();
    state.cards.x9 = { columnId: "done", order: "a0", deleted: true };
    expect(codeOf(runIntent(state, { name: "deleteColumn", args: { columnId: "done" } }, editor))).toBe("OK");
  });
  it("deleting an already deleted column is a no-op success", () => {
    const result = runIntent(board(), { name: "deleteColumn", args: { columnId: "old" } }, editor);
    expect(result).toEqual({ ok: true, changes: [] });
  });
});

describe("R5 WIP limit can't go below the current count", () => {
  it("rejects a limit lower than the live card count", () => {
    expect(run({ name: "setWipLimit", args: { columnId: "todo", wipLimit: 1 } })).toBe("WIP_BELOW_COUNT");
  });
  it("accepts a limit equal to the count, and null", () => {
    expect(run({ name: "setWipLimit", args: { columnId: "todo", wipLimit: 2 } })).toBe("OK");
    expect(run({ name: "setWipLimit", args: { columnId: "doing", wipLimit: null } })).toBe("OK");
  });
});

describe("R6 deleted cards can't be moved", () => {
  it("rejects moveCard on a deleted card", () => {
    expect(run({ name: "moveCard", args: { cardId: "x9", columnId: "done", order: "a0" } })).toBe(
      "CARD_DELETED",
    );
  });
});

describe("R7 invalid intents", () => {
  it.each([
    ["unknown intent name", { name: "dropTable", args: {} }],
    ["missing args", { name: "moveCard" }],
    ["missing field", { name: "moveCard", args: { cardId: "a1", columnId: "done" } }],
    ["extra field", { name: "deleteCard", args: { cardId: "a1", force: true } }],
    ["bad order key", { name: "moveCard", args: { cardId: "a1", columnId: "done", order: "a 0" } }],
    ["bad id", { name: "deleteCard", args: { cardId: "../etc" } }],
    ["WIP limit 0", { name: "setWipLimit", args: { columnId: "todo", wipLimit: 0 } }],
    ["not an object", "moveCard"],
    ["unknown card", { name: "moveCard", args: { cardId: "zz", columnId: "done", order: "a0" } }],
    ["unknown column", { name: "moveCard", args: { cardId: "a1", columnId: "zz", order: "a0" } }],
    ["duplicate card id", { name: "createCard", args: { cardId: "a1", columnId: "done", order: "a0" } }],
    ["duplicate column id", { name: "createColumn", args: { columnId: "todo", order: "a9" } }],
  ])("%s → INVALID", (_label, intent) => {
    expect(run(intent)).toBe("INVALID");
  });
});

describe("R9 preconditions (used by undo)", () => {
  it("rejects when the card no longer matches `expect`", () => {
    // Alice moved a1 to doing; Bob then moved it to done; Alice's undo expects it in doing.
    const state = board();
    state.cards.a1 = { columnId: "done", order: "a0", deleted: false };
    const undo = {
      name: "moveCard",
      args: { cardId: "a1", columnId: "todo", order: "a0", expect: { columnId: "doing" } },
    };
    expect(codeOf(runIntent(state, undo, editor))).toBe("STALE");
  });

  it("accepts when `expect` still holds", () => {
    expect(
      run({
        name: "moveCard",
        args: { cardId: "a1", columnId: "done", order: "a0", expect: { columnId: "todo", order: "a0" } },
      }),
    ).toBe("OK");
  });

  it("works for column intents", () => {
    expect(
      run({ name: "setWipLimit", args: { columnId: "doing", wipLimit: 3, expect: { wipLimit: 5 } } }),
    ).toBe("STALE");
  });
});

describe("mutators are pure", () => {
  it("never modify the input state", () => {
    const state = board();
    const snapshot = structuredClone(state);
    apply(state, { name: "moveCard", args: { cardId: "a1", columnId: "done", order: "a0" } });
    apply(state, { name: "deleteCard", args: { cardId: "a2" } });
    expect(state).toEqual(snapshot);
  });

  it("emit whole values so a move is replaced atomically (D2)", () => {
    const result = runIntent(
      board(),
      { name: "moveCard", args: { cardId: "a1", columnId: "done", order: "a5" } },
      editor,
    );
    expect(result).toEqual({
      ok: true,
      changes: [{ kind: "card", id: "a1", value: { columnId: "done", order: "a5", deleted: false } }],
    });
  });
});

describe("restoreColumn (undo of deleteColumn)", () => {
  it("brings a deleted column back, and is a no-op on a live one", () => {
    expect(runIntent(board(), { name: "restoreColumn", args: { columnId: "old" } }, editor)).toEqual({
      ok: true,
      changes: [{ kind: "column", id: "old", value: { order: "a3", wipLimit: null, deleted: false } }],
    });
    expect(runIntent(board(), { name: "restoreColumn", args: { columnId: "todo" } }, editor)).toEqual({
      ok: true,
      changes: [],
    });
  });
  it("respects `expect`", () => {
    expect(run({ name: "restoreColumn", args: { columnId: "old", expect: { deleted: false } } })).toBe(
      "STALE",
    );
  });
});
