import { z } from "zod";

/**
 * What each tab tells the others about itself (D6). Ephemeral: sent over the awareness
 * protocol, never stored, never undoable (P6).
 *
 * Cursor positions are relative to the element under the pointer (a card, a column, or the
 * board), not raw pixels. Two people's screens have different widths, so "x = 640px" means
 * different places, but "40% across card c1" means the same place on both (P2).
 */
export const presenceSchema = z.object({
  user: z.object({
    name: z.string().max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  cursor: z
    .object({
      anchor: z.string().max(80), // a card id, a column id, or "board"
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .nullable(),
  /** The card or column this person has focused (P3). */
  focus: z.string().max(80).nullable(),
  /** The card this person is dragging (P4). */
  dragging: z.string().max(80).nullable(),
});

export type Presence = z.infer<typeof presenceSchema>;

export interface Peer extends Presence {
  clientId: number;
}

/** Other people's states are untrusted input: drop anything that doesn't fit the schema. */
export function parsePresence(state: unknown): Presence | null {
  const result = presenceSchema.safeParse(state);
  return result.success ? result.data : null;
}
