import { z } from "zod";

const id = z.string().regex(/^[\w-]{1,64}$/);

/** Fractional-index key (D5). Only the charset is checked; ordering is the client's job. */
const orderKey = z.string().regex(/^[0-9A-Za-z]{1,128}$/);

const wipLimit = z.number().int().min(1).max(999).nullable();

const cardExpect = z
  .object({ columnId: id, order: orderKey, deleted: z.boolean() })
  .partial()
  .strict();

const columnExpect = z
  .object({ order: orderKey, wipLimit, deleted: z.boolean() })
  .partial()
  .strict();

/**
 * Every structural change a client can ask for (D4).
 * `expect` is an optional precondition (R9), used by undo so it never overwrites someone else's change.
 */
export const intentSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("createCard"),
    args: z.object({ cardId: id, columnId: id, order: orderKey }).strict(),
  }),
  z.object({
    name: z.literal("moveCard"),
    args: z
      .object({ cardId: id, columnId: id, order: orderKey, expect: cardExpect.optional() })
      .strict(),
  }),
  z.object({
    name: z.literal("deleteCard"),
    args: z.object({ cardId: id, expect: cardExpect.optional() }).strict(),
  }),
  z.object({
    name: z.literal("restoreCard"),
    args: z.object({ cardId: id, expect: cardExpect.optional() }).strict(),
  }),
  z.object({
    name: z.literal("createColumn"),
    args: z.object({ columnId: id, order: orderKey, wipLimit: wipLimit.optional() }).strict(),
  }),
  z.object({
    name: z.literal("moveColumn"),
    args: z.object({ columnId: id, order: orderKey, expect: columnExpect.optional() }).strict(),
  }),
  z.object({
    name: z.literal("deleteColumn"),
    args: z.object({ columnId: id, expect: columnExpect.optional() }).strict(),
  }),
  z.object({
    name: z.literal("restoreColumn"),
    args: z.object({ columnId: id, expect: columnExpect.optional() }).strict(),
  }),
  z.object({
    name: z.literal("setWipLimit"),
    args: z.object({ columnId: id, wipLimit, expect: columnExpect.optional() }).strict(),
  }),
]);

export type IntentBody = z.infer<typeof intentSchema>;
export type IntentName = IntentBody["name"];
export type IntentArgs<N extends IntentName> = Extract<IntentBody, { name: N }>["args"];

/** What travels over the wire: the body plus a client-generated id (for ack/nack and R8). */
export type Intent = IntentBody & { id: string };

export function parseIntent(
  raw: unknown,
): { ok: true; intent: IntentBody } | { ok: false; message: string } {
  const result = intentSchema.safeParse(raw);
  if (result.success) return { ok: true, intent: result.data };
  return { ok: false, message: z.prettifyError(result.error) };
}

/** The card or column an intent is about, e.g. to show a "saving…" marker on it (O2). */
export function intentTarget(intent: IntentBody): string {
  return "cardId" in intent.args ? intent.args.cardId : intent.args.columnId;
}
