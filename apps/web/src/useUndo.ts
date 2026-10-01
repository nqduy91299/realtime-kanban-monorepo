import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { BoardUndo, type BoardClient } from "@kanban/client";
import { describeUndo, describeUndoFailure } from "./messages.js";
import { useToast } from "./Toasts.js";

/** Is the keyboard focus in something that has its own text undo? */
function inTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") ||
      target.tagName === "TEXTAREA")
  );
}

/**
 * Board undo/redo (U1): toolbar buttons plus Cmd/Ctrl+Z, Shift+Cmd+Z and Ctrl+Y.
 * Inside a text field the shortcuts belong to that field instead (U5, see CollaborativeInput).
 */
export function useUndo(client: BoardClient) {
  const toast = useToast();
  // Created and destroyed in the same effect. (With useMemo + a cleanup effect, React StrictMode's
  // mount → unmount → mount in development destroys the history and then keeps reusing the dead one.
  // The E2E tests caught exactly that: undo silently never recorded anything.)
  const [history, setHistory] = useState<BoardUndo | null>(null);
  useEffect(() => {
    const next = new BoardUndo(client);
    // Creating the history *is* the effect (it subscribes to the client). See the comment above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(next);
    return () => next.destroy();
  }, [client]);

  const subscribe = useCallback(
    (listener: () => void) => history?.subscribe(listener) ?? (() => {}),
    [history],
  );
  const canUndo = useSyncExternalStore(subscribe, () => history?.canUndo ?? false);
  const canRedo = useSyncExternalStore(subscribe, () => history?.canRedo ?? false);

  const run = useCallback(
    (direction: "undo" | "redo") => {
      if (!history) return;
      const result = direction === "undo" ? history.undo() : history.redo();
      if (!result.entry) return;
      toast(
        result.ok
          ? describeUndo(client, result.entry.original, direction)
          : describeUndoFailure(client, result.entry.original, direction, result.code),
      );
    },
    [client, history, toast],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || inTextField(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") run(event.shiftKey ? "redo" : "undo");
      else if (event.ctrlKey && key === "y") run("redo");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  return { canUndo, canRedo, undo: () => run("undo"), redo: () => run("redo") };
}
