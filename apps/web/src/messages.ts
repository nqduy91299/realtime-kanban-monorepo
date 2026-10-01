import type { BoardClient } from "@kanban/client";
import { getText, textKey, type IntentBody, type RejectCode } from "@kanban/shared";

/** Plain-language reason for every reject code (§4). */
export function reason(code: RejectCode, columnTitle?: string, wipLimit?: number | null): string {
  switch (code) {
    case "FORBIDDEN":
      return "you have view-only access";
    case "COLUMN_DELETED":
      return "that column was deleted";
    case "WIP_LIMIT":
      return columnTitle && wipLimit ? `“${columnTitle}” is full (limit ${wipLimit})` : "that column is full";
    case "COLUMN_NOT_EMPTY":
      return "the column still has cards. Move or delete them first";
    case "WIP_BELOW_COUNT":
      return "the limit can't be lower than the number of cards already there";
    case "CARD_DELETED":
      return "someone deleted that card";
    case "INVALID":
      return "it no longer fits the board";
    case "STALE":
      return "someone changed it after you";
    case "DEV_REJECT":
      return "the dev panel rejected it";
  }
}

const VERB: Record<IntentBody["name"], string> = {
  createCard: "add",
  moveCard: "move",
  deleteCard: "delete",
  restoreCard: "restore",
  createColumn: "add column",
  moveColumn: "move column",
  deleteColumn: "delete column",
  restoreColumn: "restore column",
  setWipLimit: "change the limit of",
};

/** The card or column title an intent is about. */
export function subjectOf(client: BoardClient, intent: IntentBody): string {
  const key =
    "cardId" in intent.args
      ? textKey.cardTitle(intent.args.cardId)
      : textKey.columnTitle(intent.args.columnId);
  return getText(client.content, key).toString().trim() || "Untitled";
}

/** e.g. `Undone: move “Fix bug”.` */
export function describeUndo(client: BoardClient, original: IntentBody, direction: "undo" | "redo"): string {
  return `${direction === "undo" ? "Undone" : "Redone"}: ${VERB[original.name]} “${subjectOf(client, original)}”.`;
}

/** e.g. `Couldn't undo: someone changed “Fix bug” after you.` */
export function describeUndoFailure(
  client: BoardClient,
  original: IntentBody,
  direction: "undo" | "redo",
  code: RejectCode,
): string {
  const subject = subjectOf(client, original);
  if (code === "STALE") return `Couldn't ${direction}: someone changed “${subject}” after you.`;
  return `Couldn't ${direction} ${VERB[original.name]} “${subject}”: ${reason(code)}.`;
}

/** e.g. `Couldn't move “Fix bug”: “Doing” is full (limit 3).` */
export function describeFailure(client: BoardClient, intent: IntentBody, code: RejectCode): string {
  const title = (key: string) => getText(client.content, key).toString().trim() || "Untitled";
  const subject =
    "cardId" in intent.args
      ? title(textKey.cardTitle(intent.args.cardId))
      : title(textKey.columnTitle(intent.args.columnId));
  const targetColumn = "columnId" in intent.args ? intent.args.columnId : undefined;
  const column = targetColumn ? client.getView().board.columns[targetColumn] : undefined;
  const why = reason(
    code,
    targetColumn ? title(textKey.columnTitle(targetColumn)) : undefined,
    column?.wipLimit,
  );
  return `Couldn't ${VERB[intent.name]} “${subject}”: ${why}.`;
}
