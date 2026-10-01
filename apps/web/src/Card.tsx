import type { CSSProperties } from "react";
import type { BoardClient } from "@kanban/client";
import type { Peer } from "@kanban/shared";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getText, textKey } from "@kanban/shared";
import { CollaborativeInput } from "./CollaborativeInput.js";
import { useDrag } from "./DragProvider.js";
import type { Highlight } from "./useBoard.js";
import { useYText } from "./useYText.js";
import { useMutate } from "./useMutate.js";

interface Props {
  client: BoardClient;
  cardId: string;
  pending: boolean;
  highlight: Highlight | undefined;
  focusedBy: Peer[];
  draggedBy: Peer | undefined;
  readOnly: boolean;
}

/** Name tags of the people looking at an item (P3). */
export function PeerTags({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) return null;
  return (
    <span className="peer-tags">
      {peers.map((p) => (
        <span key={p.clientId} className="peer-tag" style={{ background: p.user.color }}>
          {p.user.name}
        </span>
      ))}
    </span>
  );
}

/**
 * A card. Its handle (⠿) is how you move it: drag with a mouse or finger, or focus it and press
 * Space, then arrow keys (M5). The title is edited in place.
 */
export function Card({ client, cardId, pending, highlight, focusedBy, draggedBy, readOnly }: Props) {
  const mutate = useMutate(client);
  const { drag, onHandleKey, onHandleBlur } = useDrag();
  const titleText = getText(client.content, textKey.cardTitle(cardId));
  const title = useYText(titleText).trim() || "Untitled";

  const draggable = useDraggable({ id: `card:${cardId}`, disabled: readOnly });
  const droppable = useDroppable({ id: `drop-card:${cardId}`, disabled: readOnly });
  const lifted = drag?.kind === "card" && drag.cardId === cardId;

  const ringColor = draggedBy?.user.color ?? focusedBy[0]?.user.color;
  const className = [
    "card",
    pending && "is-pending",
    highlight && `is-${highlight}`,
    ringColor && "has-peer",
    lifted && "is-lifted",
    draggable.isDragging && "is-placeholder",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      ref={(el) => {
        draggable.setNodeRef(el);
        droppable.setNodeRef(el);
      }}
      className={className}
      aria-busy={pending}
      data-anchor={cardId}
      style={ringColor ? ({ "--peer": ringColor } as CSSProperties) : undefined}
    >
      <PeerTags peers={focusedBy} />
      {draggedBy && (
        <span className="moving" style={{ background: draggedBy.user.color }}>
          {draggedBy.user.name} is moving…
        </span>
      )}
      <div className="card-row">
        {!readOnly && (
          <button
            type="button"
            className="drag-handle"
            ref={draggable.setActivatorNodeRef}
            {...draggable.listeners}
            data-drag-handle={cardId}
            aria-label={`Move ${title}`}
            aria-describedby="drag-help"
            aria-pressed={lifted}
            onKeyDown={(e) => onHandleKey(e, { kind: "card", id: cardId })}
            onBlur={onHandleBlur}
          >
            ⠿
          </button>
        )}
        <CollaborativeInput
          className="card-title"
          text={titleText}
          aria-label="Card title"
          placeholder="Untitled"
          readOnly={readOnly}
        />
        {!readOnly && (
          <button
            type="button"
            className="danger card-delete"
            aria-label={`Delete ${title}`}
            onClick={() => mutate("deleteCard", { cardId })}
          >
            ✕
          </button>
        )}
      </div>
      {pending && <span className="saving">Saving…</span>}
    </li>
  );
}
