import { describe, expect, it } from "vitest";
import * as Y from "yjs";

/**
 * U5: the field-level undo in CollaborativeInput is a Y.UndoManager that tracks only the field's
 * own typing origin. These tests pin that configuration's behaviour on two replicas.
 */
const TYPING = Symbol("typing");

function replicas() {
  const mine = new Y.Doc();
  const theirs = new Y.Doc();
  mine.on("update", (u: Uint8Array, origin) => origin !== "net" && Y.applyUpdate(theirs, u, "net"));
  theirs.on("update", (u: Uint8Array, origin) => origin !== "net" && Y.applyUpdate(mine, u, "net"));
  const text = mine.getText("t");
  const history = new Y.UndoManager(text, { trackedOrigins: new Set([TYPING]), captureTimeout: 0 });
  const type = (index: number, s: string) => mine.transact(() => text.insert(index, s), TYPING);
  return { text, theirText: theirs.getText("t"), history, type };
}

describe("U5 text undo", () => {
  it("undoes my typing and leaves someone else's", () => {
    const { text, theirText, history, type } = replicas();
    type(0, "Fix bug");
    theirText.insert(0, "Urgent: "); // arrives over the network
    type(15, " now");

    history.undo();
    expect(text.toString()).toBe("Urgent: Fix bug");
    history.undo();
    expect(text.toString()).toBe("Urgent: "); // only their words remain
    expect(theirText.toString()).toBe("Urgent: "); // and the undo synced to them like any edit
    history.redo();
    expect(text.toString()).toBe("Urgent: Fix bug");
  });

  it("someone else's edit alone gives me nothing to undo", () => {
    const { theirText, history } = replicas();
    theirText.insert(0, "hello");
    expect(history.canUndo()).toBe(false);
  });
});
