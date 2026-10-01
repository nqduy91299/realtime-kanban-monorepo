import { useCallback } from "react";
import type { BoardClient, MutateResult } from "@kanban/client";
import type { IntentArgs, IntentName } from "@kanban/shared";
import { describeFailure } from "./messages.js";
import { useToast } from "./Toasts.js";

/** client.mutate(), plus a toast when the change is refused locally (no round trip needed). */
export function useMutate(client: BoardClient) {
  const toast = useToast();
  return useCallback(
    <N extends IntentName>(name: N, args: IntentArgs<N>): MutateResult => {
      const result = client.mutate(name, args);
      if (!result.ok) toast(describeFailure(client, { name, args } as never, result.code));
      return result;
    },
    [client, toast],
  );
}
