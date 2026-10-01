import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { throttle, toRelative, type BoardClient } from "@kanban/client";
import type { Peer } from "@kanban/shared";
import { colorFor, loadName, saveName } from "./identity.js";

const NO_PEERS: readonly Peer[] = [];

/** Everyone else on the board (P1), re-rendering only when their presence changes. */
export function usePeers(client: BoardClient | null): readonly Peer[] {
  const subscribe = useCallback(
    (listener: () => void) => client?.onPresence(listener) ?? (() => {}),
    [client],
  );
  return useSyncExternalStore(subscribe, () => client?.getPeers() ?? NO_PEERS);
}

/** Your own name; announced to the others and remembered in this browser. */
export function useIdentity(client: BoardClient | null) {
  const [name, setName] = useState(loadName);

  useEffect(() => {
    const clean = name.trim().slice(0, 40) || "Anonymous";
    client?.setPresence({ user: { name: clean, color: colorFor(clean) } });
    saveName(clean);
  }, [client, name]);

  return { name, setName, color: colorFor(name.trim() || "Anonymous") };
}

/**
 * Tracks your pointer (P2) and keyboard focus (P3) on the board.
 * Anything with a `data-anchor` attribute (cards, columns) can be a cursor anchor or a focus target.
 */
export function useBoardPresence(client: BoardClient | null, boardRef: RefObject<HTMLElement | null>) {
  const sendCursor = useMemo(
    () =>
      throttle(
        (cursor: { anchor: string; x: number; y: number } | null) => client?.setPresence({ cursor }),
        50,
      ),
    [client],
  );
  useEffect(() => () => sendCursor.cancel(), [sendCursor]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !client) return;

    const anchorOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-anchor]") : null;

    const onMove = (event: PointerEvent) => {
      const anchor = anchorOf(event.target);
      const rect = (anchor ?? board).getBoundingClientRect();
      sendCursor({
        anchor: anchor?.dataset.anchor ?? "board",
        ...toRelative(rect, event.clientX, event.clientY),
      });
    };
    const onLeave = () => sendCursor(null);

    const onFocusIn = (event: FocusEvent) => {
      client.setPresence({ focus: anchorOf(event.target)?.dataset.anchor ?? null });
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!anchorOf(event.relatedTarget)) client.setPresence({ focus: null });
    };

    board.addEventListener("pointermove", onMove);
    board.addEventListener("pointerleave", onLeave);
    board.addEventListener("focusin", onFocusIn);
    board.addEventListener("focusout", onFocusOut);
    return () => {
      board.removeEventListener("pointermove", onMove);
      board.removeEventListener("pointerleave", onLeave);
      board.removeEventListener("focusin", onFocusIn);
      board.removeEventListener("focusout", onFocusOut);
    };
  }, [client, boardRef, sendCursor]);
}

/** peer lookups for cards/columns: who has it focused (P3), who is dragging it (P4). */
export function indexPeers(peers: readonly Peer[]) {
  const focusedBy = new Map<string, Peer[]>();
  const draggedBy = new Map<string, Peer>();
  for (const peer of peers) {
    if (peer.focus) focusedBy.set(peer.focus, [...(focusedBy.get(peer.focus) ?? []), peer]);
    if (peer.dragging) draggedBy.set(peer.dragging, peer);
  }
  return { focusedBy, draggedBy };
}
