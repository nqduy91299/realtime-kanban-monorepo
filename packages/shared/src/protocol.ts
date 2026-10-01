import { z } from "zod";
import type { RejectCode, Role } from "./types.js";

/**
 * Wire protocol (docs/TRUTH_TABLE.md §10). JSON text frames; Yjs binary payloads are base64.
 * JSON costs ~33% more bytes than a binary framing, but every frame is readable in devtools,
 * which is worth more while learning.
 *
 * Sync handshake for a doc (standard Yjs "sync step 1 / step 2"):
 *   A → B  sync1 { stateVector of A }        "here's what I have"
 *   B → A  sync2 { update A is missing }     "here's what you lack"
 * The client runs it for both docs; the server also runs it for `content` in the other
 * direction, so edits made offline reach the server on reconnect (F4).
 *
 * Intents (structure changes):
 *   client → server  intent { id, name, args }
 *   server → all     update { doc: "structure" }   (only if accepted)
 *   server → sender  ack { id } | nack { id, code }  (always AFTER the update, O3)
 */
export type DocName = "content" | "structure";

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("sync1"), doc: z.enum(["content", "structure"]), sv: base64 }),
  // Only `content` is ever accepted from clients: the structure doc is server-written (D2).
  z.object({ t: z.literal("sync2"), doc: z.literal("content"), update: base64 }),
  z.object({ t: z.literal("update"), doc: z.literal("content"), update: base64 }),
  // Structure changes travel as intents (D4). `name`/`args` are validated by runIntent (R7).
  z.object({
    t: z.literal("intent"),
    id: z.string().regex(/^[\w-]{1,64}$/),
    name: z.string(),
    args: z.unknown(),
  }),
  // Presence (D6): a y-protocols awareness update, relayed to everyone else on the board.
  z.object({ t: z.literal("awareness"), update: base64 }),
  // Dev panel only (O8); the server ignores it unless started in dev mode.
  z.object({ t: z.literal("dev"), action: z.enum(["rejectNext", "dropNextReply"]) }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerErrorCode = "FORBIDDEN" | "BAD_MESSAGE";

export type ServerMessage =
  | { t: "welcome"; role: Role }
  | { t: "sync1"; doc: "content"; sv: string }
  | { t: "sync2"; doc: DocName; update: string }
  | { t: "update"; doc: DocName; update: string }
  | { t: "awareness"; update: string }
  | { t: "ack"; id: string }
  | { t: "nack"; id: string; code: RejectCode; message?: string }
  | { t: "error"; code: ServerErrorCode; message?: string };

/* base64 that works the same in Node and the browser */

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
