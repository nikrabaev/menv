import { Box, Text } from "ink";
import type React from "react";
import { theme } from "../theme.ts";

// Windowed list: renders only the rows that fit, keeping the selection in view,
// so lists stay responsive at thousands of items. When the list overflows the
// window it shows how many rows are hidden above/below and a proportional
// scrollbar gutter on the right. Indicators cost rows ONLY when overflowing, so
// short lists (and the 80×20 floor) keep their full height.
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
  const total = items.length;
  const H = Math.max(1, height);

  // Everything fits — render straight, no indicators.
  if (total <= H) {
    return (
      <Box flexDirection="column">{items.map((item, i) => renderItem(item, i, i === selected))}</Box>
    );
  }

  // Overflow: reserve up to two rows for the ↑/↓ count lines (slots stay present
  // even at a count of 0 so the body never jumps a row at the extremes).
  const reserve = Math.min(2, Math.max(0, H - 1));
  const innerH = Math.max(1, H - reserve);
  const showTop = reserve >= 1;
  const showBottom = reserve >= 2;
  // Keep the selection centered: scrolling begins once the cursor passes the
  // middle row, rather than pinning it to the bottom edge. Clamped so the top
  // and bottom of the list still fill the window.
  const offset = Math.min(Math.max(0, selected - Math.floor(innerH / 2)), Math.max(0, total - innerH));
  const above = offset;
  const below = total - offset - innerH;
  const visible = items.slice(offset, offset + innerH);

  // Proportional thumb: size ∝ window/total, position ∝ how far we've scrolled.
  const thumbSize = Math.min(innerH, Math.max(1, Math.round((innerH * innerH) / total)));
  const thumbStart = Math.round((offset * (innerH - thumbSize)) / Math.max(1, total - innerH));

  return (
    <Box flexDirection="column">
      {showTop ? (
        <Text color={theme.muted} dimColor>
          {above > 0 ? `  ↑ ${above} more` : " "}
        </Text>
      ) : null}
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {visible.map((item, i) => renderItem(item, offset + i, offset + i === selected))}
        </Box>
        <Box flexDirection="column" flexShrink={0}>
          {Array.from({ length: innerH }, (_, r) => {
            const onThumb = r >= thumbStart && r < thumbStart + thumbSize;
            return (
              <Text key={r} color={onThumb ? theme.accent : theme.muted} dimColor={!onThumb}>
                {onThumb ? "█" : "│"}
              </Text>
            );
          })}
        </Box>
      </Box>
      {showBottom ? (
        <Text color={theme.muted} dimColor>
          {below > 0 ? `  ↓ ${below} more` : " "}
        </Text>
      ) : null}
    </Box>
  );
}

// Shared selection-movement helper for j/k/arrows/page/home/end.
export function moveIndex(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}
