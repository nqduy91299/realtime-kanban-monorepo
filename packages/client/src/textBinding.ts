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
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end++;
  }
  return {
    index: start,
    deleteCount: before.length - start - end,
    insert: after.slice(start, after.length - end),
  };
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
  let pos = 0; // position in the old text
  let shift = 0;
  for (const op of delta) {
    if (op.retain !== undefined) {
      pos += op.retain;
      if (pos > index) break;
    } else if (op.insert !== undefined) {
      if (pos > index) break;
      shift += typeof op.insert === "string" ? op.insert.length : 1;
    } else if (op.delete !== undefined) {
      if (pos >= index) break;
      shift -= Math.min(op.delete, index - pos);
      pos += op.delete;
    }
  }
  return Math.max(0, index + shift);
}

/**
 * Where to put the caret after an undo/redo of text: just after the last thing the change
 * inserted, or where it deleted text. Like a normal text editor.
 */
export function changeEnd(delta: Delta): number {
  let pos = 0;
  let end = 0;
  for (const op of delta) {
    if (op.retain !== undefined) pos += op.retain;
    else if (op.insert !== undefined) {
      pos += typeof op.insert === "string" ? op.insert.length : 1;
      end = pos;
    } else if (op.delete !== undefined) end = pos;
  }
  return end;
}
