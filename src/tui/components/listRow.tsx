import { Box, Text } from "ink";
import type React from "react";
import type { ThemeColor } from "../theme.ts";
import { theme } from "../theme.ts";

// One styled span of a row. `color` is a semantic token; `dim` marks metadata.
export type Segment = { text: string; color?: ThemeColor; bold?: boolean; dim?: boolean };

// A selectable list row. The outer Box stretches to the full pane width (Yoga's
// default `alignItems: stretch`), so the selection band — painted by Ink across
// the box's whole computed width — spans the row edge-to-edge, not just the text.
//
// Selection is encoded three ways so it survives NO_COLOR: the band (color), a
// leading ▌ bar, and bold. The bar is accent when the pane is focused and muted
// when it is blurred, so you never lose your place when tabbing between panes.
export function ListRow({
  segments,
  selected,
  focused,
}: {
  segments: Segment[];
  selected: boolean;
  focused: boolean;
}): React.ReactElement {
  const active = selected && focused;
  return (
    <Box backgroundColor={selected ? theme.selectionBand : undefined}>
      <Text color={active ? theme.selectionBar : theme.muted} bold={active}>
        {selected ? "▌ " : "  "}
      </Text>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate">
          {segments.map((s, i) => {
            // Muted/dim spans wash out on the gray band — promote them to the
            // default (brighter) fg while a row is selected; keep semantic colors.
            const wash = selected && (s.dim === true || s.color === theme.muted);
            return (
              <Text
                key={`${i}:${s.text}`}
                color={wash ? undefined : s.color}
                bold={s.bold === true || active}
                dimColor={s.dim === true && !selected}
              >
                {s.text}
              </Text>
            );
          })}
        </Text>
      </Box>
    </Box>
  );
}
