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
  // Fast path for the common (unselected) row: a single truncating Text — no
  // band, so no need for the full-width Box wrappers. Nested Text are inline
  // spans (one Yoga node), where the selected path below costs ~4 nodes/row.
  // Lists re-render every keystroke, so keeping the 99% case to one node is
  // what keeps scrolling smooth at scale.
  if (!selected) {
    return (
      <Text wrap="truncate">
        <Text color={theme.muted}>{"  "}</Text>
        {segments.map((s, i) => (
          <Text key={`${i}:${s.text}`} color={s.color} bold={s.bold === true} dimColor={s.dim === true}>
            {s.text}
          </Text>
        ))}
      </Text>
    );
  }
  // Selected row: the gray band fills the row edge-to-edge (the outer Box bg +
  // the flexGrow inner Box stretch it to full width). Only 1–2 rows hit this.
  return (
    <Box backgroundColor={theme.selectionBand}>
      <Text color={focused ? theme.selectionBar : theme.muted} bold={focused}>
        {"▌ "}
      </Text>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate">
          {segments.map((s, i) => {
            // Muted/dim spans wash out on the gray band — promote them to the
            // default (brighter) fg on the selected row; keep semantic colors.
            const wash = s.dim === true || s.color === theme.muted;
            return (
              <Text key={`${i}:${s.text}`} color={wash ? undefined : s.color} bold={s.bold === true || focused}>
                {s.text}
              </Text>
            );
          })}
        </Text>
      </Box>
    </Box>
  );
}
