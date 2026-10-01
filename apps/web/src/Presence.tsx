import { useEffect, useReducer, type RefObject } from "react";
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
      <ul className="avatars" aria-label={`${peers.length} other ${peers.length === 1 ? "person" : "people"} here`}>
        {peers.map((peer) => (
          <li key={peer.clientId} className="avatar" style={{ background: peer.user.color }} title={peer.user.name}>
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
 */
export function Cursors({ peers, boardRef }: { peers: readonly Peer[]; boardRef: RefObject<HTMLElement | null> }) {
  const [, relayout] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("resize", relayout);
    return () => window.removeEventListener("resize", relayout);
  }, []);

  const board = boardRef.current;
  if (!board) return null;
  const boardRect = board.getBoundingClientRect();

  return (
    <div className="cursors" aria-hidden="true">
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        const { anchor, x, y } = peer.cursor;
        const el = anchor === "board" ? board : board.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);
        if (!el) return null;
        const { left, top } = fromRelative(el.getBoundingClientRect(), boardRect, x, y);
        return (
          <div key={peer.clientId} className="cursor" style={{ transform: `translate(${left}px, ${top}px)` }}>
            <svg width="16" height="18" viewBox="0 0 16 18">
              <path d="M1 1l13 7-6 1.6L5 16z" fill={peer.user.color} stroke="white" strokeWidth="1.2" />
            </svg>
            <span className="cursor-name" style={{ background: peer.user.color }}>
              {peer.user.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
