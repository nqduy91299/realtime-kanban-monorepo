import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromRelative, throttle, toRelative } from "../src/index.js";

describe("P2 cursor anchoring", () => {
  it("the same fraction of a card lands on that card on both screens", () => {
    // Alice's card is 300px wide at x=100; Bob's is 200px wide at x=40 (narrower window).
    const alice = { left: 100, top: 50, width: 300, height: 60 };
    const bob = { left: 40, top: 80, width: 200, height: 60 };
    const { x, y } = toRelative(alice, 250, 65); // halfway across, a quarter down
    expect({ x, y }).toEqual({ x: 0.5, y: 0.25 });
    expect(fromRelative(bob, { left: 0, top: 0, width: 800, height: 600 }, x, y)).toEqual({
      left: 140,
      top: 95,
    });
  });

  it("round-trips any point inside the element (property)", () => {
    fc.assert(
      fc.property(
        fc.record({
          left: fc.integer({ min: -500, max: 500 }),
          top: fc.integer({ min: -500, max: 500 }),
          width: fc.integer({ min: 1, max: 900 }),
          height: fc.integer({ min: 1, max: 900 }),
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (rect, fx, fy) => {
          const px = rect.left + fx * rect.width;
          const py = rect.top + fy * rect.height;
          const rel = toRelative(rect, px, py);
          const back = fromRelative(rect, { left: 0, top: 0, width: 0, height: 0 }, rel.x, rel.y);
          expect(back.left).toBeCloseTo(px, 6);
          expect(back.top).toBeCloseTo(py, 6);
        },
      ),
    );
  });

  it("clamps points outside the element, and survives zero-size elements", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(toRelative(rect, -50, 250)).toEqual({ x: 0, y: 1 });
    expect(toRelative({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe("throttle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the first call at once, then at most one per interval, ending with the latest", () => {
    const calls: number[] = [];
    const send = throttle((n: number) => calls.push(n), 50);
    for (let i = 1; i <= 10; i++) {
      send(i);
      vi.advanceTimersByTime(10); // 10 moves in 100 ms
    }
    vi.advanceTimersByTime(100);
    expect(calls[0]).toBe(1);
    expect(calls.at(-1)).toBe(10); // the final position is never lost
    expect(calls.length).toBeLessThanOrEqual(4); // ~20 Hz, not 100 Hz
  });

  it("cancel drops a pending trailing call", () => {
    const calls: number[] = [];
    const send = throttle((n: number) => calls.push(n), 50);
    send(1);
    send(2);
    send.cancel();
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([1]);
  });
});
