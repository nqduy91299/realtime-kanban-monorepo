import { useState, type CSSProperties, type FormEvent } from "react";
import type { BoardClient, BoardView } from "@kanban/client";
import type { Peer } from "@kanban/shared";
import { useDroppable } from "@dnd-kit/core";
import { cardOrderAt, getText, sortedCardIds, textKey } from "@kanban/shared";
import { Card, PeerTags } from "./Card.js";
import { CollaborativeInput } from "./CollaborativeInput.js";
import { useDrag } from "./DragProvider.js";
import type { Highlight } from "./useBoard.js";
import { useMutate } from "./useMutate.js";
import { useYText } from "./useYText.js";

interface Props {
  client: BoardClient;
  view: BoardView;
  columnId: string;
  highlights: ReadonlyMap<string, Highlight>;
  focusedBy: ReadonlyMap<string, Peer[]>;
  draggedBy: ReadonlyMap<string, Peer>;
  readOnly: boolean;
}

export function Column({ client, view, columnId, highlights, focusedBy, draggedBy, readOnly }: Props) {
  const mutate = useMutate(client);
  const { board, pending } = view;
  const column = board.columns[columnId]!;
  const cardIds = sortedCardIds(board, columnId);
  const { drag, onHandleKey, onHandleBlur } = useDrag();
  const droppable = useDroppable({ id: `drop-col:${columnId}`, disabled: readOnly });
  const lifted = drag?.kind === "column" && drag.columnId === columnId;
  const titleText = getText(client.content, textKey.columnTitle(columnId));
  const title = useYText(titleText).trim() || "Untitled";
  const full = column.wipLimit !== null && cardIds.length >= column.wipLimit;
  // Only possible in a drag preview: shows that dropping here would break the limit.
  const over = column.wipLimit !== null && cardIds.length > column.wipLimit;

  const [draft, setDraft] = useState("");
  const addCard = (event: FormEvent) => {
    event.preventDefault();
    const cardId = crypto.randomUUID();
    const result = mutate("createCard", { cardId, columnId, order: cardOrderAt(board, columnId, cardIds.length) });
    if (result.ok) {
      // The title goes into the text doc. If the create is rejected, this text is simply never shown.
      getText(client.content, textKey.cardTitle(cardId)).insert(0, draft.trim());
      setDraft("");
    }
  };

  const setLimit = (raw: string) => {
    const wipLimit = raw.trim() === "" ? null : Number(raw);
    if (wipLimit === column.wipLimit || (wipLimit !== null && !(Number.isInteger(wipLimit) && wipLimit >= 1))) return;
    mutate("setWipLimit", { columnId, wipLimit });
  };

  const watchers = focusedBy.get(columnId) ?? [];
  const className = [
    "column",
    pending.has(columnId) && "is-pending",
    highlights.get(columnId) && `is-${highlights.get(columnId)}`,
    watchers.length > 0 && "has-peer",
    lifted && "is-lifted",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={droppable.setNodeRef}
      className={className}
      aria-label={`Column ${title}`}
      data-anchor={columnId}
      style={watchers[0] ? ({ "--peer": watchers[0].user.color } as CSSProperties) : undefined}
    >
      <PeerTags peers={watchers} />
      <div className="column-head">
        {!readOnly && (
          <button
            type="button"
            className="drag-handle"
            data-drag-handle={columnId}
            aria-label={`Move column ${title}`}
            aria-describedby="drag-help"
            aria-pressed={lifted}
            onKeyDown={(e) => onHandleKey(e, { kind: "column", id: columnId })}
            onBlur={onHandleBlur}
          >
            ⠿
          </button>
        )}
        <CollaborativeInput className="column-title" text={titleText} aria-label="Column title" readOnly={readOnly} />
        <span className={over ? "count is-over" : full ? "count is-full" : "count"} title="Cards / WIP limit">
          {cardIds.length}
          {column.wipLimit !== null && ` / ${column.wipLimit}`}
        </span>
      </div>

      <ol className="cards">
        {cardIds.map((cardId) => (
          <Card
            key={cardId}
            client={client}
            cardId={cardId}
            pending={pending.has(cardId)}
            highlight={highlights.get(cardId)}
            focusedBy={focusedBy.get(cardId) ?? []}
            draggedBy={draggedBy.get(cardId)}
            readOnly={readOnly}
          />
        ))}
      </ol>

      {!readOnly && (
        <>
          <form className="add-card" onSubmit={addCard}>
            <label className="visually-hidden" htmlFor={`add-${columnId}`}>
              New card in {title}
            </label>
            <input
              id={`add-${columnId}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a card…"
            />
            <button type="submit" disabled={draft.trim() === ""}>
              Add
            </button>
          </form>

          <div className="column-tools">
            <label htmlFor={`wip-${columnId}`}>WIP limit</label>
            <input
              key={column.wipLimit ?? "none"}
              id={`wip-${columnId}`}
              type="number"
              min={1}
              placeholder="none"
              defaultValue={column.wipLimit ?? ""}
              onBlur={(e) => setLimit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <button type="button" className="danger" onClick={() => mutate("deleteColumn", { columnId })}>
              Delete column
            </button>
          </div>
        </>
      )}
    </section>
  );
}
