/**
 * Cursor positions relative to an element (P2), so they land on the same card or column on
 * every screen even when layouts differ in width.
 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Pointer position → fraction of the element's box (0..1 on each axis). */
export function toRelative(rect: Rect, clientX: number, clientY: number): { x: number; y: number } {
  return {
    x: clamp01(rect.width === 0 ? 0 : (clientX - rect.left) / rect.width),
    y: clamp01(rect.height === 0 ? 0 : (clientY - rect.top) / rect.height),
  };
}

/** Fraction of an element's box → position inside `container` (both rects in viewport coordinates). */
export function fromRelative(rect: Rect, container: Rect, x: number, y: number): { left: number; top: number } {
  return {
    left: rect.left - container.left + clamp01(x) * rect.width,
    top: rect.top - container.top + clamp01(y) * rect.height,
  };
}

/**
 * Call `fn` at most once per `ms`, always delivering the latest arguments (leading + trailing).
 * Cursor updates use it to stay at ~20 per second (P2) without losing the final position.
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const run = () => {
    timer = undefined;
    last = Date.now();
    const args = pending!;
    pending = undefined;
    fn(...args);
  };
  const throttled = (...args: A) => {
    pending = args;
    const wait = last + ms - Date.now();
    if (wait <= 0 && timer === undefined) run();
    else if (timer === undefined) timer = setTimeout(run, wait);
  };
  throttled.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  return throttled;
}
