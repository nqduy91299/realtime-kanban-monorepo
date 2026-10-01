import type { BoardState, IntentBody, RejectCode } from "@kanban/shared";
import type { BoardClient } from "./BoardClient.js";

/**
 * The change that reverses `intent`, and the one that re-applies it, given the board just before it.
 *
 * Each carries `expect`: the state *our* change left behind. If someone else has changed that item
 * since, the precondition fails (STALE, R9) instead of silently overwriting their work (U4).
 * Undo is therefore just another intent: it goes through the same validation as anything else (U3).
 *
 * Returns null for changes that did nothing (deleting something already deleted, for example).
 */
export function invertIntent(
  before: BoardState,
  intent: IntentBody,
): { undo: IntentBody; redo: IntentBody } | null {
  switch (intent.name) {
    case "moveCard": {
      const { cardId, columnId, order } = intent.args;
      const prev = before.cards[cardId];
      if (!prev || (prev.columnId === columnId && prev.order === order)) return null;
      return {
        undo: {
          name: "moveCard",
          args: { cardId, columnId: prev.columnId, order: prev.order, expect: { columnId, order } },
        },
        redo: {
          name: "moveCard",
          args: { cardId, columnId, order, expect: { columnId: prev.columnId, order: prev.order } },
        },
      };
    }
    case "createCard":
    case "restoreCard": {
      const { cardId } = intent.args;
      if (intent.name === "restoreCard" && !before.cards[cardId]?.deleted) return null;
      return {
        undo: { name: "deleteCard", args: { cardId, expect: { deleted: false } } },
        // A card is never created twice: redo brings the soft-deleted one back.
        redo: { name: "restoreCard", args: { cardId, expect: { deleted: true } } },
      };
    }
    case "deleteCard": {
      const { cardId } = intent.args;
      if (!before.cards[cardId] || before.cards[cardId].deleted) return null;
      return {
        undo: { name: "restoreCard", args: { cardId, expect: { deleted: true } } },
        redo: { name: "deleteCard", args: { cardId, expect: { deleted: false } } },
      };
    }
    case "createColumn":
    case "restoreColumn": {
      const { columnId } = intent.args;
      if (intent.name === "restoreColumn" && !before.columns[columnId]?.deleted) return null;
      return {
        undo: { name: "deleteColumn", args: { columnId, expect: { deleted: false } } },
        redo: { name: "restoreColumn", args: { columnId, expect: { deleted: true } } },
      };
    }
    case "deleteColumn": {
      const { columnId } = intent.args;
      if (!before.columns[columnId] || before.columns[columnId].deleted) return null;
      return {
        undo: { name: "restoreColumn", args: { columnId, expect: { deleted: true } } },
        redo: { name: "deleteColumn", args: { columnId, expect: { deleted: false } } },
      };
    }
    case "moveColumn": {
      const { columnId, order } = intent.args;
      const prev = before.columns[columnId];
      if (!prev || prev.order === order) return null;
      return {
        undo: { name: "moveColumn", args: { columnId, order: prev.order, expect: { order } } },
        redo: { name: "moveColumn", args: { columnId, order, expect: { order: prev.order } } },
      };
    }
    case "setWipLimit": {
      const { columnId, wipLimit } = intent.args;
      const prev = before.columns[columnId];
      if (!prev || prev.wipLimit === wipLimit) return null;
      return {
        undo: { name: "setWipLimit", args: { columnId, wipLimit: prev.wipLimit, expect: { wipLimit } } },
        redo: { name: "setWipLimit", args: { columnId, wipLimit, expect: { wipLimit: prev.wipLimit } } },
      };
    }
  }
}

export interface UndoEntry {
  /** The change as the user made it, e.g. for "Undid move of …". */
  original: IntentBody;
  undo: IntentBody;
  redo: IntentBody;
  /** Id of the intent that last applied this entry (original, undo or redo), to drop it if rejected. */
  intentId: string;
}

export type UndoResult =
  | { ok: true; entry: UndoEntry }
  | { ok: false; entry: UndoEntry; code: RejectCode }
  | { ok: false; entry: null };

/**
 * Board undo/redo (M6). Local only: it records this tab's own changes, never anyone else's (U2).
 * In memory only: history survives going offline but not a reload (U9).
 */
export class BoardUndo {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<() => void>();
  private stops: (() => void)[];

  constructor(
    private client: BoardClient,
    private limit = 100,
  ) {
    this.stops = [
      client.onMutate((intent, before, source) => {
        if (source !== "user") return;
        const inverse = invertIntent(before, intent);
        if (!inverse) return;
        this.undoStack.push({ original: intent, ...inverse, intentId: intent.id });
        if (this.undoStack.length > this.limit) this.undoStack.shift(); // U9
        this.redoStack = []; // U6: a new change starts a new future
        this.notify();
      }),
      // A change the server rejected never happened, so there's nothing to undo (or redo) (U3).
      client.onRejected(({ intent }) => {
        const keep = (e: UndoEntry) => e.intentId !== intent.id;
        const before = this.undoStack.length + this.redoStack.length;
        this.undoStack = this.undoStack.filter(keep);
        this.redoStack = this.redoStack.filter(keep);
        if (this.undoStack.length + this.redoStack.length !== before) this.notify();
      }),
    ];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): UndoResult {
    return this.step(this.undoStack, this.redoStack, "undo");
  }

  redo(): UndoResult {
    return this.step(this.redoStack, this.undoStack, "redo");
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    for (const stop of this.stops) stop();
  }

  private step(from: UndoEntry[], to: UndoEntry[], direction: "undo" | "redo"): UndoResult {
    const entry = from.pop();
    if (!entry) return { ok: false, entry: null };
    const intent = entry[direction];
    const result = this.client.mutate(intent.name, intent.args, direction);
    if (!result.ok) {
      // Refused locally (e.g. STALE: someone changed it since). The entry can't apply any more: drop it.
      this.notify();
      return { ok: false, entry, code: result.code };
    }
    to.push({ ...entry, intentId: result.id });
    this.notify();
    return { ok: true, entry };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
