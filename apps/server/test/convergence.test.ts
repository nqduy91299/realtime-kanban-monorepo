import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { getText, keyBetween, readBoardState, sortedCardIds, textKey } from "@kanban/shared";
import { connect, eventually, startServer } from "./helpers.js";

/**
 * S3 through the real server: three clients make random edits to two fields, and randomly go
 * offline and come back while editing. Once everyone is online and quiet, all clients and the
 * server must hold the same text.
 * Structure intents run through the same steps; every client's view must end equal to the
 * server's structure, with nothing left in any outbox.
 */
describe("S3 convergence through the server (property)", () => {
  const keys = [textKey.columnTitle("todo"), textKey.columnTitle("done")];
  const CARDS = 5;

  const step = fc.oneof(
    fc.record({
      kind: fc.constant("insert" as const),
      client: fc.nat(2),
      key: fc.nat(1),
      pos: fc.nat(30),
      text: fc.string({ minLength: 1, maxLength: 3 }),
    }),
    fc.record({
      kind: fc.constant("delete" as const),
      client: fc.nat(2),
      key: fc.nat(1),
      pos: fc.nat(30),
      len: fc.integer({ min: 1, max: 3 }),
    }),
    fc.record({ kind: fc.constant("toggle" as const), client: fc.nat(2) }),
    fc.record({
      kind: fc.constant("move" as const),
      client: fc.nat(2),
      card: fc.nat(CARDS - 1),
      column: fc.constantFrom("todo", "doing", "done"),
      front: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant("trash" as const),
      client: fc.nat(2),
      card: fc.nat(CARDS - 1),
      restore: fc.boolean(),
    }),
  );

  it("every client and the server end with identical text", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(step, fc.boolean()), { minLength: 1, maxLength: 40 }),
        async (steps) => {
          const server = await startServer();
          const clients = [await connect(server), await connect(server), await connect(server)];
          const online = [true, true, true];
          for (let i = 0; i < CARDS; i++) {
            clients[0]!.mutate("createCard", {
              cardId: `c${i}`,
              columnId: "todo",
              order: keyBetween(i === 0 ? null : `a${i - 1}`, null),
            });
          }
          await eventually(() =>
            clients.forEach((c) =>
              expect(Object.keys(readBoardState(c.structure).cards)).toHaveLength(CARDS),
            ),
          );

          for (const [s, pause] of steps) {
            const client = clients[s.client]!;
            if (s.kind === "toggle") {
              if (online[s.client]) client.disconnect();
              else client.connect();
              online[s.client] = !online[s.client];
            } else if (s.kind === "move") {
              // May be refused locally (e.g. WIP limit) or rejected later by the server; both are fine.
              const board = client.getView().board;
              const ids = sortedCardIds(board, s.column);
              const edge = s.front ? ids[0] : ids.at(-1);
              const edgeOrder = edge ? board.cards[edge]!.order : null;
              const order = s.front ? keyBetween(null, edgeOrder) : keyBetween(edgeOrder, null);
              client.mutate("moveCard", { cardId: `c${s.card}`, columnId: s.column, order });
            } else if (s.kind === "trash") {
              client.mutate(s.restore ? "restoreCard" : "deleteCard", { cardId: `c${s.card}` });
            } else {
              const text = getText(client.content, keys[s.key]!);
              const pos = Math.min(s.pos, text.length);
              if (s.kind === "insert") text.insert(pos, s.text);
              else if (text.length > 0) {
                const start = Math.min(pos, text.length - 1);
                text.delete(start, Math.min(s.len, text.length - start));
              }
            }
            if (pause) await new Promise((r) => setTimeout(r, 1)); // let some messages interleave
          }

          clients.forEach((c, i) => !online[i] && c.connect());
          await Promise.all(clients.map((c) => c.whenSynced()));

          await eventually(() => {
            const room = server.rooms.get("b1")!;
            for (const key of keys) {
              const expected = getText(room.content, key).toString();
              for (const c of clients) expect(getText(c.content, key).toString()).toBe(expected);
            }
            // Every intent answered, and every view equals the server's structure.
            const expected = readBoardState(room.structure);
            for (const c of clients) {
              expect(c.getOutbox()).toHaveLength(0);
              expect(c.getView().board).toEqual(expected);
            }
          }, 5000);

          await server.close();
          clients.forEach((c) => c.destroy());
        },
      ),
      { numRuns: 25 },
    );
  }, 60_000);
});
