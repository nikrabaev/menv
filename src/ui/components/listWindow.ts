// Windows a list around the cursor for a fixed-height pane.
//
// `capacity` is the number of item rows available when BOTH overflow markers
// ("↑ N more" / "↓ N more") are shown. A marker only earns its row when it hides
// at least 2 items; when a side has 0 or 1 hidden item there is no marker and its
// row is reclaimed for an item. So the caller can render a marker for any side
// whose hidden count — `offset` above, `length - (offset + items.length)` below —
// is > 0, and this function guarantees that count is never exactly 1.
//
// The window has three zones so the visible count stays stable as the cursor
// moves (no shrinking while parked at an edge):
//   - top    (cursor near the start): no top marker, `capacity + 1` items
//   - bottom (cursor near the end):   no bottom marker, `capacity + 1` items
//   - middle: both markers, `capacity` items centered on the cursor
export function listWindow<T>(items: T[], cursor: number, capacity: number): { items: T[]; offset: number } {
  if (capacity <= 0) return { items: [], offset: 0 };

  const n = items.length;
  // With both marker rows reclaimed for items, capacity + 2 rows are available;
  // if everything fits there, show it all with no markers.
  if (n <= capacity + 2) return { items, offset: 0 };

  const safeCursor = Math.max(0, Math.min(cursor, n - 1));
  // Where a both-markers window centered on the cursor would sit. Its distance
  // from each end tells us which zone we're in.
  const centeredOffset = Math.max(0, Math.min(safeCursor - Math.floor(capacity / 2), n - capacity));
  const centeredBelow = n - centeredOffset - capacity;

  let offset: number;
  let count: number;
  if (centeredOffset <= 1) {
    // Top zone: 0 or 1 items above — show them instead of a top marker.
    offset = 0;
    count = capacity + 1;
  } else if (centeredBelow <= 1) {
    // Bottom zone: mirror of the top zone.
    count = capacity + 1;
    offset = n - count;
  } else {
    // Middle: both markers, window centered on the cursor.
    offset = centeredOffset;
    count = capacity;
  }

  return { items: items.slice(offset, offset + count), offset };
}
