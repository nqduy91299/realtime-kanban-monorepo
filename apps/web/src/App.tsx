import { useMemo, useRef } from "react";
import type { BoardClient, Status } from "@kanban/client";
import { columnOrderAt, getText, sortedColumnIds, textKey, type Role } from "@kanban/shared";
import { Column } from "./Column.js";
import { DevPanel } from "./DevPanel.js";
import { DragProvider } from "./DragProvider.js";
import { Cursors, PresenceBar } from "./Presence.js";
import { ToastProvider } from "./Toasts.js";
import { useBoard, useHighlights } from "./useBoard.js";
import { useMutate } from "./useMutate.js";
import { useUndo } from "./useUndo.js";
import { indexPeers, useBoardPresence, useIdentity, usePeers } from "./usePresence.js";

const params = new URLSearchParams(location.search);
const boardId = params.get("board") ?? "demo";
const role: Role = params.get("role") === "viewer" ? "viewer" : "editor";
const readOnly = role === "viewer";

const STATUS_LABEL: Record<Status, string> = {
  connecting: "Connecting…",
  syncing: "Syncing…",
  online: "Connected",
  offline: "Offline",
};

export function App() {
  const { client, status, view, loaded } = useBoard(boardId, role);
  const pendingCount = client?.getOutbox().length ?? 0;
  const highlights = useHighlights(client);
  const boardRef = useRef<HTMLElement>(null);
  const peers = usePeers(client);
  const identity = useIdentity(client);
  useBoardPresence(client, boardRef);
  const { focusedBy, draggedBy } = useMemo(() => indexPeers(peers), [peers]);

  return (
    <ToastProvider client={client}>
      <div className="app">
        <header className="bar">
          <h1>Board · {boardId}</h1>
          <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
          <span className="role">{readOnly ? "View only" : "Editor"}</span>
          {client && !readOnly && <UndoControls client={client} />}
          <PresenceBar
            peers={peers}
            name={identity.name}
            color={identity.color}
            onRename={identity.setName}
          />
        </header>

        {status === "offline" && loaded && client?.hasData && (
          <div className="offline-banner" role="status">
            <strong>Offline: changes are saved on this device.</strong>{" "}
            {pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} will sync when you're back online.`
              : "They'll sync when you're back online."}
          </div>
        )}

        {client && import.meta.env.DEV && <DevPanel client={client} />}

        {loaded && client && !client.hasData && status === "offline" && (
          <div className="unavailable" role="alert">
            <h2>This board isn't available offline</h2>
            <p>Open it once while you're connected, and it will work offline on this device from then on.</p>
          </div>
        )}

        {client && (
          <DragProvider client={client} view={view}>
            {(preview) => (
              <main className="board" aria-label="Board" ref={boardRef}>
                {sortedColumnIds(preview).map((columnId) => (
                  <Column
                    key={columnId}
                    client={client}
                    view={{ ...view, board: preview }}
                    columnId={columnId}
                    highlights={highlights}
                    focusedBy={focusedBy}
                    draggedBy={draggedBy}
                    readOnly={readOnly}
                  />
                ))}
                {!readOnly && <AddColumn client={client} />}
                <Cursors peers={peers} boardRef={boardRef} />
              </main>
            )}
          </DragProvider>
        )}

        <footer className="hint">
          Open a second tab to see changes sync. Use the dev panel to add delay or force a rejection. Add{" "}
          <code>?board=other</code> for a separate board, or <code>&amp;role=viewer</code> for read-only.
        </footer>
      </div>
    </ToastProvider>
  );
}

/** U1. Lives inside ToastProvider, because undo reports what it did (or why it couldn't). */
function UndoControls({ client }: { client: BoardClient }) {
  const { canUndo, canRedo, undo, redo } = useUndo(client);
  const mac = navigator.platform.startsWith("Mac");
  return (
    <div className="undo-controls">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        aria-keyshortcuts={mac ? "Meta+Z" : "Control+Z"}
        title={mac ? "Undo (⌘Z)" : "Undo (Ctrl+Z)"}
      >
        ↶ Undo
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        aria-keyshortcuts={mac ? "Meta+Shift+Z" : "Control+Y"}
        title={mac ? "Redo (⇧⌘Z)" : "Redo (Ctrl+Y)"}
      >
        ↷ Redo
      </button>
    </div>
  );
}

function AddColumn({ client }: { client: BoardClient }) {
  const mutate = useMutate(client);
  const add = () => {
    const columnId = crypto.randomUUID();
    const board = client.getView().board;
    const result = mutate("createColumn", {
      columnId,
      order: columnOrderAt(board, sortedColumnIds(board).length),
    });
    if (result.ok) getText(client.content, textKey.columnTitle(columnId)).insert(0, "New column");
  };
  return (
    <button type="button" className="add-column" onClick={add}>
      + Add column
    </button>
  );
}
