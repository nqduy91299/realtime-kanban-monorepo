import { applyChanges, runIntent, type BoardState, type MutationResult } from "../src/index.js";

export const editor = { role: "editor" } as const;
export const viewer = { role: "viewer" } as const;

/**
 * todo: a1, a2 · doing (WIP 2): b1 · done: empty · old: deleted column
 * x9 is a deleted card in todo.
 */
export function board(): BoardState {
  return {
    columns: {
      todo: { order: "a0", wipLimit: null, deleted: false },
      doing: { order: "a1", wipLimit: 2, deleted: false },
      done: { order: "a2", wipLimit: null, deleted: false },
      old: { order: "a3", wipLimit: null, deleted: true },
    },
    cards: {
      a1: { columnId: "todo", order: "a0", deleted: false },
      a2: { columnId: "todo", order: "a1", deleted: false },
      b1: { columnId: "doing", order: "a0", deleted: false },
      x9: { columnId: "todo", order: "a2", deleted: true },
    },
  };
}

/** Run as the server would: validate, then apply if accepted. */
export function apply(state: BoardState, intent: unknown): { state: BoardState; result: MutationResult } {
  const result = runIntent(state, intent, editor);
  return { state: result.ok ? applyChanges(state, result.changes) : state, result };
}

export function codeOf(result: MutationResult): string {
  return result.ok ? "OK" : result.code;
}
