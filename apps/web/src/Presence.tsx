import { useLayoutEffect, useRef, type RefObject } from "react";
import { fromRelative } from "@kanban/client";
import type { Peer } from "@kanban/shared";
import { initials } from "./identity.js";

/** Header avatars: you first, then everyone else (P1). */
export function PresenceBar({
  peers,
  name,
  color,
  onRename,
}: {
  peers: readonly Peer[];
  name: string;
  color: string;
  onRename: (name: string) => void;
}) {
  return (
    <div className="presence">
      <label className="you">
        <span className="avatar" style={{ background: color }} aria-hidden="true">
          {initials(name)}
        </span>
        <span className="visually-hidden">Your name</span>
        <input value={name} maxLength={40} onChange={(e) => onRename(e.target.value)} />
      </label>
      <ul
        className="avatars"
        aria-label={`${peers.length} other ${peers.length === 1 ? "person" : "people"} here`}
      >
        {peers.map((peer) => (
          <li
            key={peer.clientId}
            className="avatar"
            style={{ background: peer.user.color }}
            title={peer.user.name}
          >
            <span aria-hidden="true">{initials(peer.user.name)}</span>
            <span className="visually-hidden">{peer.user.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Other people's pointers (P2), drawn over the board. Each position is resolved against *this*
 * screen's copy of the anchor element, so it lands on the same card even if our layouts differ.
 * If the anchor isn't on this screen (e.g. a card we haven't received yet), the cursor is hidden.
 *
 * Positions come from measuring the DOM, which React must not do while rendering. So the cursors
 * are rendered without a position, then placed in a layout effect: after layout, before paint, so
 * they never flicker. A window resize re-places them without re-rendering anything.
 */
export function Cursors({
  peers,
  boardRef,
}: {
  peers: readonly Peer[];
  boardRef: RefObject<HTMLElement | null>;
}) {
  const elements = useRef(new Map<number, HTMLDivElement>());

  useLayoutEffect(() => {
    const place = () => {
      const board = boardRef.current;
      if (!board) return;
      const boardRect = board.getBoundingClientRect();
      for (const peer of peers) {
        const cursorEl = elements.current.get(peer.clientId);
        if (!cursorEl || !peer.cursor) continue;
        const { anchor, x, y } = peer.cursor;
        const anchorEl =
          anchor === "board" ? board : board.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
        cursorEl.hidden = !anchorEl;
        if (!anchorEl) continue;
        const { left, top } = fromRelative(anchorEl.getBoundingClientRect(), boardRect, x, y);
        if (!cursorEl.dataset.placed) {
          // First placement: jump straight there instead of sliding in from the corner.
          cursorEl.style.transition = "none";
          cursorEl.dataset.placed = "1";
          requestAnimationFrame(() => (cursorEl.style.transition = ""));
        }
        cursorEl.style.transform = `translate(${left}px, ${top}px)`;
      }
    };
    place(); // after every render: cards may have moved, appeared, or changed size
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });

  return (
    <div className="cursors" aria-hidden="true">
      {peers.map((peer) =>
        peer.cursor ? (
          <div
            key={peer.clientId}
            className="cursor"
            ref={(el) => {
              if (el) elements.current.set(peer.clientId, el);
              else elements.current.delete(peer.clientId);
            }}
          >
            <svg width="16" height="18" viewBox="0 0 16 18">
              <path d="M1 1l13 7-6 1.6L5 16z" fill={peer.user.color} stroke="white" strokeWidth="1.2" />
            </svg>
            <span className="cursor-name" style={{ background: peer.user.color }}>
              {peer.user.name}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}
