// TODO lesson 9: the stubs below don't use their parameters yet. Delete these two lines when you're done.
/* eslint-disable @typescript-eslint/no-unused-vars */
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
  // TODO lesson 9: one case per intent name (switch on intent.name). Read the comment above first:
  // every undo and redo carries `expect`. This placeholder means "nothing to undo", so the app
  // runs, but the undo button never lights up.
  return null;
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
    // TODO lesson 9 (U3, U4): take the latest entry from `from`, send its `direction` intent with
    // this.client.mutate(name, args, direction), and:
    //  - refused locally (e.g. STALE)? Drop the entry: it can never apply again.
    //  - accepted? Move it to `to`, remembering the *new* intent id (if the server rejects it later,
    //    the onRejected handler in the constructor drops it by that id).
    // Notify listeners either way, so the buttons update.
    return { ok: false, entry: null };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
