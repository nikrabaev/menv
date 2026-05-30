export function listWindow<T>(items: T[], cursor: number, maxItems: number): { items: T[]; offset: number } {
  if (maxItems <= 0) return { items: [], offset: 0 };
  if (items.length <= maxItems) return { items, offset: 0 };

  const safeCursor = Math.max(0, Math.min(cursor, items.length - 1));
  const half = Math.floor(maxItems / 2);
  const offset = Math.max(0, Math.min(safeCursor - half, items.length - maxItems));

  return { items: items.slice(offset, offset + maxItems), offset };
}
