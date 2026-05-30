import { expect, test, describe } from "bun:test";
import { listWindow } from "../../../src/ui/components/listWindow.ts";

const seq = (n: number) => Array.from({ length: n }, (_, i) => i);
const below = (n: number, w: { items: number[]; offset: number }) => n - w.offset - w.items.length;

describe("listWindow", () => {
  test("returns nothing when there is no room", () => {
    expect(listWindow(seq(10), 0, 0)).toEqual({ items: [], offset: 0 });
  });

  test("shows everything when it fits in capacity + 2 (the marker rows are free)", () => {
    // capacity 5 -> up to 7 items render without any overflow marker.
    expect(listWindow(seq(7), 3, 5)).toEqual({ items: seq(7), offset: 0 });
  });

  test("windows around the cursor with both markers in the middle", () => {
    const w = listWindow(seq(10), 5, 5);
    expect(w.items.length).toBe(5);
    expect(w.offset).toBeGreaterThanOrEqual(2); // >= 2 hidden above -> top marker
    expect(below(10, w)).toBeGreaterThanOrEqual(2); // >= 2 hidden below -> bottom marker
  });

  test("absorbs a lone item above instead of showing '1 more'", () => {
    // cursor 3, capacity 5 -> natural offset would be 1 (item 0 hidden); absorb it.
    const w = listWindow(seq(10), 3, 5);
    expect(w.offset).toBe(0);
    expect(w.items.length).toBe(6);
    expect(below(10, w)).toBeGreaterThanOrEqual(2);
  });

  test("absorbs a lone item below instead of showing '1 more'", () => {
    // cursor 6, capacity 5 -> natural window leaves exactly 1 below; absorb it.
    const w = listWindow(seq(10), 6, 5);
    expect(below(10, w)).toBe(0);
    expect(w.items.length).toBe(6);
    expect(w.offset).toBeGreaterThanOrEqual(2); // top marker still warranted
  });

  test("keeps a stable visible count while the cursor moves within the top zone", () => {
    // Regression: at the top of a long list, stepping the cursor up/down must not
    // grow or shrink the window (it was flip-flopping 30<->31 items).
    const n = 41;
    const capacity = 30;
    // centeredOffset stays <= 1 (the top zone) for cursors 0..16.
    for (let cursor = 0; cursor <= 16; cursor++) {
      const w = listWindow(seq(n), cursor, capacity);
      expect(w.offset).toBe(0);
      expect(w.items.length).toBe(capacity + 1);
      expect(below(n, w)).toBe(n - (capacity + 1));
    }
  });

  test("never leaves exactly one item hidden on either side, and never overflows", () => {
    const capacity = 5;
    for (const n of [8, 9, 10, 13, 20]) {
      for (let cursor = 0; cursor < n; cursor++) {
        const w = listWindow(seq(n), cursor, capacity);
        const hiddenAbove = w.offset;
        const hiddenBelow = below(n, w);
        expect(hiddenAbove).not.toBe(1);
        expect(hiddenBelow).not.toBe(1);
        // The selected item is always visible.
        expect(cursor).toBeGreaterThanOrEqual(w.offset);
        expect(cursor).toBeLessThan(w.offset + w.items.length);
        // Rendered rows (items + any markers) stay within the pane budget.
        const rows = w.items.length + (hiddenAbove > 0 ? 1 : 0) + (hiddenBelow > 0 ? 1 : 0);
        expect(rows).toBeLessThanOrEqual(capacity + 2);
      }
    }
  });
});
