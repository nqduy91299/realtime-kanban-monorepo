export type Role = "editor" | "viewer";

/** Structure values (D2). Each one is replaced as a whole, never field by field. */
export interface ColumnValue {
  order: string;
  wipLimit: number | null;
  deleted: boolean;
}

export interface CardValue {
  columnId: string;
  order: string;
  deleted: boolean;
}

/** Plain-object view of the `structure` doc. Card/column text lives in the `content` doc. */
export interface BoardState {
  columns: Record<string, ColumnValue>;
  cards: Record<string, CardValue>;
}

export type Change =
  | { kind: "column"; id: string; value: ColumnValue }
  | { kind: "card"; id: string; value: CardValue };

/** Server rules R1–R9 (docs/TRUTH_TABLE.md §4). */
export type RejectCode =
  | "FORBIDDEN"
  | "COLUMN_DELETED"
  | "WIP_LIMIT"
  | "COLUMN_NOT_EMPTY"
  | "WIP_BELOW_COUNT"
  | "CARD_DELETED"
  | "INVALID"
  | "STALE"
  /** Never produced by a mutator: the dev panel's "reject next intent" (O8). */
  | "DEV_REJECT";

export type MutationResult =
  | { ok: true; changes: Change[] }
  | { ok: false; code: RejectCode; message?: string };

export interface MutationContext {
  role: Role;
}
