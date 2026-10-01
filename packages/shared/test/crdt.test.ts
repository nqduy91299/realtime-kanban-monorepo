import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { getText } from "../src/index.js";

/**
 * These tests use Yjs directly, with no network. They show what the CRDT guarantees
 * before we trust it through the server.
 */

/** Two replicas that start from the same text. */
function pair(initial: string) {
  const a = new Y.Doc();
  getText(a, "t").insert(0, initial);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return { a, b, ta: getText(a, "t"), tb: getText(b, "t") };
}

/** Deliver each side's missing updates to the other. */
function exchange(a: Y.Doc, b: Y.Doc) {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB);
  Y.applyUpdate(a, toA);
}

describe("C1 concurrent edits at different positions", () => {
  it("both edits survive", () => {
    const { a, b, ta, tb } = pair("Fix bug");
    ta.insert(7, " now"); // Alice appends
    tb.insert(0, "Urgent: "); // Bob prepends, without having seen Alice's edit
    exchange(a, b);
    expect(ta.toString()).toBe("Urgent: Fix bug now");
    expect(tb.toString()).toBe("Urgent: Fix bug now");
  });
});

describe("C2 concurrent inserts at the same position", () => {
  it("both are kept, in the same order on every replica", () => {
    const { a, b, ta, tb } = pair("abc");
    ta.insert(3, "X");
    tb.insert(3, "Y");
    exchange(a, b);
    expect(ta.toString()).toBe(tb.toString());
    expect(["abcXY", "abcYX"]).toContain(ta.toString());
  });
});

describe("C3 insert inside a range someone else deleted", () => {
  it("the insert survives", () => {
    const { a, b, ta, tb } = pair("0123456789");
    ta.delete(2, 6); // Alice deletes "234567"
    tb.insert(5, "Z"); // Bob types inside that range
    exchange(a, b);
    expect(ta.toString()).toBe("01Z89");
    expect(tb.toString()).toBe("01Z89");
  });
});

describe("S3 convergence (property test)", () => {
  type Op = { replica: number; kind: "insert" | "delete"; pos: number; text: string; len: number };

  const op = fc.record({
    replica: fc.integer({ min: 0, max: 2 }),
    kind: fc.constantFrom("insert" as const, "delete" as const),
    pos: fc.nat(40),
    text: fc.string({ minLength: 1, maxLength: 3 }),
    len: fc.integer({ min: 1, max: 4 }),
  });

  it("any edits, delivered in any order, give identical text everywhere", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 30 }), fc.integer(), (ops: Op[], seed) => {
        const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
        const updates: Uint8Array[][] = docs.map(() => []);
        docs.forEach((d, i) =>
          d.on("update", (u: Uint8Array, origin) => origin !== "net" && updates[i]!.push(u)),
        );

        // Each replica edits in isolation (as if everyone were offline).
        for (const o of ops) {
          const t = getText(docs[o.replica]!, "t");
          const pos = Math.min(o.pos, t.length);
          if (o.kind === "insert") t.insert(pos, o.text);
          else if (t.length > 0) {
            const start = Math.min(pos, t.length - 1);
            t.delete(start, Math.min(o.len, t.length - start));
          }
        }

        // Deliver every update to every other replica, in a shuffled order per receiver.
        const all = updates.flat();
        docs.forEach((d, i) => {
          const shuffled = [...all].sort((x, y) => hash(x, seed + i) - hash(y, seed + i));
          for (const u of shuffled) Y.applyUpdate(d, u, "net");
        });

        const texts = docs.map((d) => getText(d, "t").toString());
        expect(texts[1]).toBe(texts[0]);
        expect(texts[2]).toBe(texts[0]);
      }),
      { numRuns: 300 },
    );
  });
});

/** Deterministic pseudo-random sort key for an update. */
function hash(bytes: Uint8Array, seed: number): number {
  let h = seed | 0;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619);
  return h;
}
