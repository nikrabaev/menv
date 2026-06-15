// The 'human' presentation of the Variables tab: each variable is a multi-line
// card — a name/description header (the description scrolls when the card is
// active) above a full-width consumer | value table grouped so the most-shared
// values come first. ENTER focuses the table; the focused row opens the editor.
import { Box, Text } from "ink";
import type React from "react";
import type { VariableDef } from "../../registry/types.ts";
import { ListRow, type Segment } from "../components/listRow.tsx";
import { useMarquee } from "../components/marquee.tsx";
import { isSelectable, settleIndex, variablesList } from "../state/lists.ts";
import { cardWindow, humanVarRows, maskValue, truncate } from "../state/selectors.ts";
import type { AppState } from "../state/store.tsx";
import { theme } from "../theme.ts";

// header line + table rows (min one "not wired" line). Must equal what VarCard
// actually renders — the window budgets from this, so an over-count under-fills.
const cardHeight = (rowCount: number): number => 1 + Math.max(1, rowCount);

function columns(width: number): { consumer: number; value: number } {
  const usable = Math.max(20, width - 4); // leading bar/indent
  const consumer = Math.min(30, Math.max(12, Math.floor(usable * 0.4)));
  return { consumer, value: Math.max(8, usable - consumer - 2) };
}

function VarCard({
  name,
  def,
  vault,
  values,
  selected,
  focused,
  rowFocus,
  rowIndex,
  cardIndex,
  width,
}: {
  name: string;
  def: VariableDef;
  vault: string;
  values: Record<string, string> | null;
  selected: boolean;
  focused: boolean;
  rowFocus: boolean;
  rowIndex: number; // cursor row within THIS card's table (only meaningful when rowFocus)
  cardIndex: number; // this card's ordinal among cards (for zebra striping)
  width: number;
}): React.ReactElement {
  const secret = def.secret === true;
  const cols = columns(width);
  const nameShown = truncate(name, 28);
  const descWidth = Math.max(0, width - 4 - nameShown.length - (secret ? 2 : 0) - 2);
  const desc = useMarquee(def.description ?? "", descWidth, selected);
  const rows = humanVarRows(def, vault, values);
  // the bar marks the active card; it dims while the table (not the header) owns focus
  const barColor = selected ? (focused && !rowFocus ? theme.selectionBar : theme.muted) : theme.muted;
  // run the same rail down every row of the active card so the whole card reads
  // as selected, not just its header. ┃ (a box-drawing vertical, like the pane
  // borders) tiles seamlessly between lines where a ▌ half-block leaves gaps.
  const lead = selected ? { text: "┃ ", color: barColor, bold: true } : undefined;

  return (
    <Box flexDirection="column" backgroundColor={cardIndex % 2 === 0 ? "black" : undefined}>
      <Text wrap="truncate">
        <Text color={barColor} bold={selected}>
          {selected ? "┃ " : "  "}
        </Text>
        <Text bold={selected}>{nameShown}</Text>
        {secret ? <Text color={theme.secret}> S</Text> : null}
        {def.description !== undefined && def.description !== "" ? <Text color={theme.muted}>{`  ${desc}`}</Text> : null}
      </Text>
      {rows.length === 0 ? (
        <Text wrap="truncate">
          <Text color={barColor} bold={selected}>
            {selected ? "┃ " : "  "}
          </Text>
          <Text color={theme.muted} dimColor>
            {`  — not wired in "${vault}" (w to wire)`}
          </Text>
        </Text>
      ) : (
        rows.map((row, i) => {
          const valueText =
            row.hasValue === undefined ? "⚿ locked" : maskValue(secret, row.value);
          const segments: Segment[] = [
            { text: `  ${truncate(row.consumer, cols.consumer).padEnd(cols.consumer)}`, color: theme.muted, dim: true },
            {
              text: ` ${row.disabled ? "# " : ""}${truncate(valueText, cols.value)}`,
              color: row.hasValue === false ? theme.error : undefined,
              dim: row.disabled,
            },
          ];
          return (
            <ListRow
              key={row.consumer}
              segments={segments}
              selected={rowFocus && i === rowIndex}
              focused={focused}
              lead={lead}
            />
          );
        })
      )}
    </Box>
  );
}

export function HumanVariablesTab({
  state,
  height,
  width,
}: {
  state: AppState;
  height: number;
  width: number;
}): React.ReactElement {
  const rows = variablesList(state);
  const focused = state.focus === "main";
  if (rows.length === 0) {
    const anyDefined = Object.keys(state.registry.variables).length > 0;
    return (
      <Text color={theme.muted}>
        {anyDefined ? "no variables match — esc clears the filter" : "no variables yet — press n to define, i to import a .env"}
      </Text>
    );
  }
  const values = state.vaults[state.activeVault]?.values ?? null;
  const selected = settleIndex(rows, state.mainIndex.variables, isSelectable);
  const heights = rows.map((r) =>
    r.type === "header" ? 1 : cardHeight(humanVarRows(r.def, state.activeVault, values).length),
  );
  // stable per-card ordinal (group headers don't count) so zebra striping keeps
  // its parity as the window scrolls instead of flipping with the visible slice
  const cardOrdinals: number[] = [];
  let cardCount = 0;
  for (const r of rows) {
    cardOrdinals.push(cardCount);
    if (r.type !== "header") cardCount += 1;
  }

  const winFull = cardWindow(heights, selected, height);
  const overflow = winFull.above > 0 || winFull.below > 0;
  const win = overflow ? cardWindow(heights, selected, Math.max(1, height - 2)) : winFull;
  const visible = rows.slice(win.offset, win.offset + win.count);

  return (
    <Box flexDirection="column">
      {overflow ? (
        <Text color={theme.muted} dimColor>
          {win.above > 0 ? `  ↑ ${win.above} more` : " "}
        </Text>
      ) : null}
      {visible.map((row, i) => {
        const idx = win.offset + i;
        if (row.type === "header") {
          return (
            <Text key={`g:${row.title}`} color={theme.muted} bold>
              ── {row.title} {"─".repeat(Math.max(0, 24 - row.title.length))}
            </Text>
          );
        }
        return (
          <VarCard
            key={row.name}
            name={row.name}
            def={row.def}
            vault={state.activeVault}
            values={values}
            selected={idx === selected}
            focused={focused}
            rowFocus={state.humanRowFocus && idx === selected}
            rowIndex={state.humanRowIndex}
            cardIndex={cardOrdinals[idx] ?? 0}
            width={width}
          />
        );
      })}
      {overflow ? (
        <Text color={theme.muted} dimColor>
          {win.below > 0 ? `  ↓ ${win.below} more` : " "}
        </Text>
      ) : null}
    </Box>
  );
}
