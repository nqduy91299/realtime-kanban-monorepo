import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BoardClient, IndexedDbStore, MemoryStore, type BoardView, type LocalStore, type Rejection, type Status } from "@kanban/client";
import type { Role } from "@kanban/shared";

const EMPTY_VIEW: BoardView = { board: { columns: {}, cards: {} }, pending: new Set() };

function serverUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}`; // Vite proxies /boards to the Node server
}

/** One IndexedDB connection per tab. Falls back to memory where IndexedDB is unavailable. */
const store: LocalStore = typeof indexedDB === "undefined" ? new MemoryStore() : new IndexedDbStore();

/** One BoardClient per mounted board. */
export function useBoard(boardId: string, role: Role) {
  const [client, setClient] = useState<BoardClient | null>(null);
  const [status, setStatus] = useState<Status>("offline");
  /** False until this device's saved copy of the board has been read (so F9 doesn't flash). */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const next = new BoardClient({ url: serverUrl(), boardId, role, store });
    const stopStatus = next.onStatus(setStatus);
    let alive = true;
    void next.ready.then(() => alive && setLoaded(true));
    next.connect();
    setClient(next);
    return () => {
      alive = false;
      setLoaded(false);
      stopStatus();
      next.destroy();
    };
  }, [boardId, role]);

  const subscribe = useCallback((listener: () => void) => client?.subscribe(listener) ?? (() => {}), [client]);
  const view = useSyncExternalStore(subscribe, () => client?.getView() ?? EMPTY_VIEW);

  return { client, status, view, loaded };
}

/** Ids that should briefly glow, and why. */
export type Highlight = "rolled-back" | "remote";

/**
 * O4: a card whose change was rejected flashes as it returns.
 * C4: a card moved by someone else gets a brief highlight instead of a notification.
 */
export function useHighlights(client: BoardClient | null, view: BoardView): ReadonlyMap<string, Highlight> {
  const [highlights, setHighlights] = useState<ReadonlyMap<string, Highlight>>(new Map());
  const previous = useRef<BoardView>(view);

  const flash = useCallback((ids: string[], kind: Highlight) => {
    if (ids.length === 0) return;
    setHighlights((current) => new Map([...current, ...ids.map((id) => [id, kind] as const)]));
    setTimeout(() => {
      setHighlights((current) => {
        const next = new Map(current);
        for (const id of ids) if (next.get(id) === kind) next.delete(id);
        return next;
      });
    }, 1200);
  }, []);

  useEffect(
    () => client?.onRejected((r: Rejection) => flash(["cardId" in r.intent.args ? r.intent.args.cardId : r.intent.args.columnId], "rolled-back")),
    [client, flash],
  );

  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    const moved: string[] = [];
    for (const [id, card] of Object.entries(view.board.cards)) {
      const old = before.board.cards[id];
      if (!old || view.pending.has(id) || before.pending.has(id)) continue; // not someone else's change
      if (old.columnId !== card.columnId || old.order !== card.order) moved.push(id);
    }
    flash(moved, "remote");
  }, [view, flash]);

  return highlights;
}
