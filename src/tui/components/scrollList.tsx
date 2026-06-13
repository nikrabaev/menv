import { Box } from "ink";
import type React from "react";

// Windowed list: renders only the rows that fit, keeping the selection in
// view. Lists stay responsive at thousands of items.
export function ScrollList<T>({
  items,
  selected,
  height,
  renderItem,
}: {
  items: T[];
  selected: number;
  height: number;
  renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
}): React.ReactElement {
  const h = Math.max(1, height);
  const offset = Math.min(Math.max(0, selected - h + 1), Math.max(0, items.length - h));
  const visible = items.slice(offset, offset + h);
  return (
    <Box flexDirection="column">
      {visible.map((item, i) => renderItem(item, offset + i, offset + i === selected))}
    </Box>
  );
}

// Shared selection-movement helper for j/k/arrows/page/home/end.
export function moveIndex(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}
