import { useCallback, useSyncExternalStore } from "react";
import type * as Y from "yjs";

/** The current string of a Y.Text, re-rendering when it changes (for labels, not for editing). */
export function useYText(text: Y.Text): string {
  const subscribe = useCallback(
    (listener: () => void) => {
      text.observe(listener);
      return () => text.unobserve(listener);
    },
    [text],
  );
  return useSyncExternalStore(subscribe, () => text.toString());
}
