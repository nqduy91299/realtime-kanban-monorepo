import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { changeEnd, diffText, transformIndex, type Delta } from "../src/index.js";

describe("diffText", () => {
  it.each([
    ["type at end", "Fix", "Fix!", { index: 3, deleteCount: 0, insert: "!" }],
    ["type in middle", "Fx", "Fix", { index: 1, deleteCount: 0, insert: "i" }],
    ["backspace", "Fix", "Fi", { index: 2, deleteCount: 1, insert: "" }],
    ["replace selection", "Fix bug", "Fix it", { index: 4, deleteCount: 3, insert: "it" }],
    ["repeated letters", "aaa", "aaaa", { index: 3, deleteCount: 0, insert: "a" }],
    // Vietnamese Telex: typing "a" then "a" turns "a" into "â" in place.
    ["IME replace", "Vi a", "Vi â", { index: 3, deleteCount: 1, insert: "â" }],
  ])("%s", (_label, before, after, expected) => {
    expect(diffText(before, after)).toEqual(expected);
  });

  it("applying the diff always yields the new value (property)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (before, after) => {
        const edit = diffText(before, after);
        const result = edit
          ? before.slice(0, edit.index) + edit.insert + before.slice(edit.index + edit.deleteCount)
          : before;
        expect(result).toBe(after);
      }),
    );
  });
});

describe("transformIndex", () => {
  const cases: [string, number, Delta, number][] = [
    ["insert before cursor pushes it right", 5, [{ retain: 2 }, { insert: "abc" }], 8],
    ["insert after cursor leaves it", 2, [{ retain: 4 }, { insert: "abc" }], 2],
    ["insert exactly at cursor pushes it right (like Yjs)", 3, [{ retain: 3 }, { insert: "x" }], 4],
    ["delete before cursor pulls it left", 6, [{ retain: 1 }, { delete: 2 }], 4],
    ["delete spanning the cursor moves it to the deletion point", 4, [{ retain: 2 }, { delete: 5 }], 2],
    ["insert at start", 0, [{ insert: "ab" }], 2],
  ];
  it.each(cases)("%s", (_label, index, delta, expected) => {
    expect(transformIndex(index, delta)).toBe(expected);
  });

  it("matches what Yjs does to a relative position (property)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.nat(),
        fc.nat(),
        fc.nat(5),
        fc.string({ maxLength: 4 }),
        (initial, cursorSeed, editSeed, deleteCount, insert) => {
          const doc = new Y.Doc();
          const text = doc.getText("t");
          text.insert(0, initial);
          const cursor = cursorSeed % (initial.length + 1);
          const at = editSeed % (initial.length + 1);
          // Yjs's own answer: a relative position anchored to the character after the cursor.
          const anchor = Y.createRelativePositionFromTypeIndex(text, cursor);

          let delta: Delta = [];
          text.observe((event) => (delta = event.delta as Delta));
          doc.transact(() => {
            text.delete(at, Math.min(deleteCount, initial.length - at));
            text.insert(at, insert);
          });

          const expected = Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index;
          expect(transformIndex(cursor, delta)).toBe(expected);
        },
      ),
    );
  });
});

describe("changeEnd", () => {
  it.each([
    ["after an insert", [{ retain: 3 }, { insert: "abc" }], 6],
    ["at a deletion", [{ retain: 4 }, { delete: 2 }], 4],
    ["after the last of several changes", [{ insert: "x" }, { retain: 5 }, { delete: 1 }, { insert: "yz" }], 8],
  ] as [string, Delta, number][])("%s", (_label, delta, expected) => {
    expect(changeEnd(delta)).toBe(expected);
  });
});
