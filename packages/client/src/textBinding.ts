// TODO lesson 4: the stubs below don't use their parameters yet. Delete these two lines when you're done.
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Pure helpers for binding a plain <input>/<textarea> to a Y.Text.
 * They're kept free of DOM and Yjs so they can be unit-tested.
 */

export interface TextEdit {
  index: number;
  deleteCount: number;
  insert: string;
}

/**
 * The smallest single edit that turns `before` into `after`.
 * An input event only tells us the new value, so we find the common prefix and suffix;
 * whatever is left in the middle was replaced. One keystroke or paste is always one such edit.
 */
export function diffText(before: string, after: string): TextEdit | null {
  // TODO lesson 4: the smallest single edit (index, deleteCount, insert) that turns before into after
  throw new Error("TODO lesson 4: diffText");
}

/** A Y.Text change event delta, e.g. [{retain: 3}, {insert: "ab"}, {delete: 1}]. */
export type Delta = { retain?: number; insert?: unknown; delete?: number }[];

/**
 * Where does a cursor at `index` end up after a remote change?
 * Text inserted before the cursor pushes it right; deleted text before it pulls it left.
 * Text inserted exactly at the cursor also pushes it right, which is what a Yjs relative
 * position does (it sticks to the character after the cursor).
 * Without this, every remote keystroke would throw your cursor to the end of the field.
 */
export function transformIndex(index: number, delta: Delta): number {
  // TODO lesson 4: walk the delta (retain / insert / delete) and shift the cursor
  throw new Error("TODO lesson 4: transformIndex");
}

/**
 * Where to put the caret after an undo/redo of text: just after the last thing the change
 * inserted, or where it deleted text. Like a normal text editor.
 */
export function changeEnd(delta: Delta): number {
  // TODO lesson 4: caret position after an undo: just after the last insert, or at the last delete
  throw new Error("TODO lesson 4: changeEnd");
}
