import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  announce,
  dropCard,
  dropColumn,
  moveDrag,
  previewBoard,
  retarget,
  slotOf,
  startCardDrag,
  startColumnDrag,
  type BoardClient,
  type BoardView,
  type Direction,
  type Drag,
  type Names,
} from "@kanban/client";
import { getText, sortedCardIds, sortedColumnIds, textKey, type BoardState } from "@kanban/shared";
import { useMutate } from "./useMutate.js";

interface DragApi {
  drag: Drag | null;
  /** Keyboard handling for a card's or column's drag handle (K1–K8). */
  onHandleKey(event: KeyboardEvent, item: { kind: "card" | "column"; id: string }): void;
  onHandleBlur(): void;
}

const DragContext = createContext<DragApi>({ drag: null, onHandleKey: () => {}, onHandleBlur: () => {} });
export const useDrag = () => useContext(DragContext);

const KEY_DIRECTION: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Prefer the card under the pointer; fall back to its column (e.g. an empty one). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const card = hits.find((h) => String(h.id).startsWith("drop-card:"));
  if (card) return [card];
  return hits.length > 0 ? [hits[0]!] : closestCenter(args);
};

function focusHandle(id: string) {
  document.querySelector<HTMLElement>(`[data-drag-handle="${CSS.escape(id)}"]`)?.focus();
}

/**
 * Owns the drag (keyboard or pointer) and renders the board through `children(preview)`:
 * while dragging, the board shows where the item would land; only the drop sends an intent.
 */
export function DragProvider({
  client,
  view,
  children,
}: {
  client: BoardClient;
  view: BoardView;
  children: (preview: BoardState) => ReactNode;
}) {
  const board = view.board;
  const mutate = useMutate(client);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState("");
  const current = useRef<Drag | null>(null);
  const via = useRef<"keyboard" | "pointer">("keyboard");
  const refocusing = useRef(false);
  const lastDropped = useRef<string | null>(null);
  current.current = drag;

  const names = useMemo<Names>(() => {
    const read = (key: string, fallback: string) => getText(client.content, key).toString().trim() || fallback;
    return {
      card: (id) => read(textKey.cardTitle(id), "Untitled card"),
      column: (id) => read(textKey.columnTitle(id), "Untitled column"),
    };
  }, [client]);

  /** The same text twice in a row must still be read out, so clear first. */
  const say = useCallback((text: string) => {
    setMessage("");
    requestAnimationFrame(() => setMessage(text));
  }, []);

  const begin = useCallback(
    (next: Drag | null, how: "keyboard" | "pointer") => {
      if (!next) return;
      via.current = how;
      setDrag(next);
      client.setPresence({ dragging: next.kind === "card" ? next.cardId : next.columnId }); // P4
      if (how === "keyboard") say(announce.pickedUp(board, next, names));
    },
    [board, client, names, say],
  );

  const end = useCallback(() => {
    setDrag(null);
    client.setPresence({ dragging: null });
  }, [client]);

  const move = useCallback(
    (direction: Direction) => {
      const before = current.current;
      if (!before) return;
      const after = moveDrag(board, before, direction);
      refocusing.current = true; // the card may be re-rendered in another column
      setDrag(after);
      say(announce.moved(board, before, after, names));
    },
    [board, names, say],
  );

  const cancel = useCallback(
    (reason?: string) => {
      const d = current.current;
      if (!d) return;
      end();
      say(`${reason ? `${reason} ` : ""}${announce.cancelled(board, d, names)}`);
      const id = d.kind === "card" ? d.cardId : d.columnId;
      requestAnimationFrame(() => focusHandle(id)); // K7
    },
    [board, end, names, say],
  );

  const drop = useCallback(() => {
    const d = current.current;
    if (!d) return;
    end();
    const id = d.kind === "card" ? d.cardId : d.columnId;
    const result =
      d.kind === "card"
        ? (() => {
            const args = dropCard(board, d);
            return args ? mutate("moveCard", args) : null;
          })()
        : (() => {
            const args = dropColumn(board, d);
            return args ? mutate("moveColumn", args) : null;
          })();
    if (result && !result.ok) {
      // Refused locally (e.g. WIP limit). useMutate already showed the reason in a toast.
      say(`Not dropped. ${announce.cancelled(board, d, names)}`);
    } else {
      lastDropped.current = id;
      say(announce.dropped(board, d, names));
    }
    requestAnimationFrame(() => focusHandle(id)); // K7: focus stays on the moved item
  }, [board, end, mutate, names, say]);

  // Keyboard: after each step the dragged item may have been re-mounted elsewhere; keep focus on it.
  useLayoutEffect(() => {
    if (!drag || via.current !== "keyboard") return;
    focusHandle(drag.kind === "card" ? drag.cardId : drag.columnId);
    refocusing.current = false;
  }, [drag]);

  // K9: the card (or column) being dragged was deleted by someone else.
  useEffect(() => {
    const d = current.current;
    if (!d) return;
    const gone = d.kind === "card" ? !slotOf(board, d.cardId) : !board.columns[d.columnId] || board.columns[d.columnId]!.deleted;
    if (gone) cancel(`${d.kind === "card" ? names.card(d.cardId) : names.column(d.columnId)} was deleted by someone else.`);
  }, [board, cancel, names]);

  // K10: a dropped move the server rejected snaps back; keep focus with it.
  useEffect(
    () =>
      client.onRejected((r) => {
        const id = "cardId" in r.intent.args ? r.intent.args.cardId : r.intent.args.columnId;
        if (id === lastDropped.current) requestAnimationFrame(() => focusHandle(id));
      }),
    [client],
  );

  /** Arrow keys without a drag: move focus between cards like a grid (K1). */
  const focusNeighbour = useCallback(
    (cardId: string, direction: Direction) => {
      const slot = slotOf(board, cardId);
      if (!slot) return;
      const columns = sortedColumnIds(board);
      if (direction === "up" || direction === "down") {
        const ids = sortedCardIds(board, slot.columnId);
        const next = ids[slot.index + (direction === "up" ? -1 : 1)];
        if (next) focusHandle(next);
        return;
      }
      const step = direction === "left" ? -1 : 1;
      for (let i = columns.indexOf(slot.columnId) + step; i >= 0 && i < columns.length; i += step) {
        const ids = sortedCardIds(board, columns[i]!);
        if (ids.length > 0) {
          focusHandle(ids[Math.min(slot.index, ids.length - 1)]!);
          return;
        }
      }
    },
    [board],
  );

  const onHandleKey = useCallback(
    (event: KeyboardEvent, item: { kind: "card" | "column"; id: string }) => {
      const d = current.current;
      const direction = KEY_DIRECTION[event.key];
      const mine = d && (d.kind === "card" ? d.cardId : d.columnId) === item.id;

      if (mine && via.current === "keyboard") {
        if (direction) move(direction);
        else if (event.key === " " || event.key === "Enter") drop();
        else if (event.key === "Escape") cancel();
        else return;
        event.preventDefault();
        return;
      }
      if (d) return; // another drag is in progress
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        begin(item.kind === "card" ? startCardDrag(board, item.id) : startColumnDrag(board, item.id), "keyboard");
      } else if (direction && item.kind === "card") {
        event.preventDefault();
        focusNeighbour(item.id, direction);
      }
    },
    [begin, board, cancel, drop, focusNeighbour, move],
  );

  // Tabbing or clicking away mid-drag cancels it (but not our own refocus after a step).
  const onHandleBlur = useCallback(() => {
    if (current.current && via.current === "keyboard" && !refocusing.current) cancel();
  }, [cancel]);

  /* ---------- pointer and touch (dnd-kit) ---------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a click stays a click
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }), // don't hijack scrolling
  );

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const d = current.current;
    if (!d || d.kind !== "card" || !over) return;
    const overId = String(over.id);
    if (overId.startsWith("drop-card:")) {
      const target = overId.slice("drop-card:".length);
      if (target === d.cardId) return;
      const columnId = board.cards[target]?.columnId;
      if (!columnId) return;
      const others = sortedCardIds(board, columnId).filter((id) => id !== d.cardId);
      // Below the middle of the card we're over → after it.
      const dragged = active.rect.current.translated;
      const below = dragged ? dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2 : false;
      setDrag(retarget(d, { columnId, index: others.indexOf(target) + (below ? 1 : 0) }));
    } else if (overId.startsWith("drop-col:")) {
      const columnId = overId.slice("drop-col:".length);
      if (d.target.columnId === columnId) return; // already somewhere in this column
      setDrag(retarget(d, { columnId, index: sortedCardIds(board, columnId).filter((id) => id !== d.cardId).length }));
    }
  };

  const preview = previewBoard(board, drag);
  const overlayCard = drag?.kind === "card" && via.current === "pointer" ? drag.cardId : null;

  return (
    <DragContext.Provider value={{ drag, onHandleKey, onHandleBlur }}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={({ active }) => begin(startCardDrag(board, String(active.id).slice("card:".length)), "pointer")}
        onDragOver={onDragOver}
        onDragEnd={() => drop()}
        onDragCancel={() => cancel()}
        accessibility={{ announcements: SILENT, screenReaderInstructions: { draggable: "" } }}
      >
        {children(preview)}
        <DragOverlay dropAnimation={null}>
          {overlayCard && <div className="card drag-overlay">{names.card(overlayCard)}</div>}
        </DragOverlay>
      </DndContext>
      <p id="drag-help" className="visually-hidden">
        Press Space to pick up. Use the arrow keys to move, Space to drop, and Escape to cancel. Without picking up, arrow
        keys move between cards.
      </p>
      <div id="drag-announcer" className="visually-hidden" aria-live="assertive" aria-atomic="true">
        {message}
      </div>
    </DragContext.Provider>
  );
}

// We announce drags ourselves (with card and column names), so dnd-kit's own announcements are off.
const SILENT = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};
