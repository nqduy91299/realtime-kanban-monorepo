import { useEffect, useRef, type InputHTMLAttributes } from "react";
import * as Y from "yjs";
import { changeEnd, diffText, transformIndex, type Delta } from "@kanban/client";

/** Origin of this field's own typing. Its UndoManager tracks only this, never remote edits (U5). */
const TYPING = Symbol("typing");

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  text: Y.Text;
};

/**
 * An <input> bound to a Y.Text.
 *
 * The input is deliberately *uncontrolled*: React never sets its value. If React re-rendered the
 * value on every remote keystroke, the browser would move your cursor to the end. We write
 * `input.value` ourselves and put the cursor back where it belongs (transformIndex).
 *
 * IME (e.g. Vietnamese Telex, Japanese): while the user is composing, the input holds text the
 * Y.Text doesn't have yet, and touching `input.value` would cancel the composition. So during
 * composition we only record remote changes, then reconcile everything at compositionend.
 *
 * Undo (U5): Cmd/Ctrl+Z in the field undoes *your* typing in *this* field only, never someone
 * else's. The browser's own undo is replaced: it knows nothing about the shared text.
 */
export function CollaborativeInput({ text, ...inputProps }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current!;
    let lastValue = text.toString(); // what the input showed after the last sync with `text`
    let composing = false;
    let missed: Delta[] = []; // remote changes that arrived during composition
    input.value = lastValue;
    // Keystrokes less than 500 ms apart undo together, like a word at a time.
    const history = new Y.UndoManager(text, { trackedOrigins: new Set([TYPING]), captureTimeout: 500 });

    const commitLocal = () => {
      const edit = diffText(lastValue, input.value);
      if (edit) {
        const index = missed.reduce((i, delta) => transformIndex(i, delta), edit.index);
        text.doc!.transact(() => {
          if (edit.deleteCount) text.delete(index, edit.deleteCount);
          if (edit.insert) text.insert(index, edit.insert);
        }, TYPING);
      }
      if (missed.length > 0) {
        // Remote text arrived meanwhile: show the merged result, caret after what we just typed.
        const caret = edit ? missed.reduce((i, d) => transformIndex(i, d), edit.index) + edit.insert.length : input.selectionStart ?? 0;
        input.value = text.toString();
        input.setSelectionRange(caret, caret);
        missed = [];
      }
      lastValue = text.toString();
    };

    // Everything that isn't our own typing: other people's edits, and our undo/redo.
    const onRemote = (event: Y.YTextEvent) => {
      if (event.transaction.origin === TYPING) return; // the input already shows it
      const delta = event.delta as Delta;
      if (composing) {
        missed.push(delta);
        return;
      }
      const { selectionStart, selectionEnd, selectionDirection } = input;
      input.value = lastValue = text.toString();
      if (event.transaction.origin === history) {
        const caret = changeEnd(delta); // like any editor: the caret goes to what was undone
        input.setSelectionRange(caret, caret);
      } else if (document.activeElement === input && selectionStart !== null && selectionEnd !== null) {
        input.setSelectionRange(
          transformIndex(selectionStart, delta),
          transformIndex(selectionEnd, delta),
          selectionDirection ?? undefined,
        );
      }
    };

    const onInput = () => {
      if (!composing) commitLocal();
    };
    const onCompositionStart = () => {
      composing = true;
    };
    const onCompositionEnd = () => {
      composing = false;
      commitLocal();
    };

    const undoOrRedo = (redo: boolean) => {
      commitLocal(); // anything typed but not yet committed belongs to the history first
      if (redo) history.redo();
      else history.undo();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (composing) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") undoOrRedo(event.shiftKey);
      else if (event.ctrlKey && key === "y") undoOrRedo(true);
      else return;
      event.preventDefault(); // also keeps the board-level undo (useUndo) from firing
    };
    // Undo from the Edit menu or a touch keyboard's undo gesture.
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
      event.preventDefault();
      undoOrRedo(event.inputType === "historyRedo");
    };

    text.observe(onRemote);
    input.addEventListener("input", onInput);
    input.addEventListener("compositionstart", onCompositionStart);
    input.addEventListener("compositionend", onCompositionEnd);
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("beforeinput", onBeforeInput);
    return () => {
      history.destroy();
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("beforeinput", onBeforeInput);
      text.unobserve(onRemote);
      input.removeEventListener("input", onInput);
      input.removeEventListener("compositionstart", onCompositionStart);
      input.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [text]);

  return <input ref={ref} {...inputProps} />;
}
