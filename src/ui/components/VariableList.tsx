import React, { useEffect, useRef, useState } from "react";
import { Box, Text, measureElement, type DOMElement } from "ink";
import type { Consumer, RepoModel, Variable } from "../../core/types.ts";
import { valueOf } from "../../core/model.ts";
import { listWindow } from "./listWindow.ts";
import { MoreIndicator } from "./MoreIndicator.tsx";
import { groupedRows } from "../grouping.ts";

const MAX_SCOPE_SHOWN = 3;
// Secret values are never shown; the value column renders this (in yellow) instead.
const SECRET_MASK = "***";
// Placeholder shown (in grey italics) in the value column when a variable has no
// value set for the current environment.
const EMPTY_LABEL = "empty";
const GUTTER = " ";
// Suffix marking a local-override variable (a `.env.local` key); shown in colour.
const LOCAL_SUFFIX = " (local)";
const dispNameLen = (v: Variable) => v.name.length + (v.local ? LOCAL_SUFFIX.length : 0);
// Value-column width used before the pane width is known (first render). Once the
// pane is measured the column is sized to the room actually left on the line.
const VALUE_FALLBACK_WIDTH = 40;

function wireHint(consumerIds: string[], allConsumers: Consumer[]): string | null {
  if (consumerIds.length === 0) return null;
  const names = consumerIds.map((id) => {
    const c = allConsumers.find((c) => c.id === id);
    return c ? `${c.kind}:${c.name}` : id;
  });
  if (names.length <= MAX_SCOPE_SHOWN) return names.join(", ");
  const rest = names.length - MAX_SCOPE_SHOWN;
  return `${names.slice(0, MAX_SCOPE_SHOWN).join(", ")} and ${rest} more`;
}

// Truncates to `width` cells, marking the cut with a single-cell ellipsis.
function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return text.slice(0, width - 1) + "…";
}

export function VariableList({ variables, cursor, height, scopeLabel, consumers, showScopes, filter, model, env, grouped = false }: {
  variables: Variable[];
  cursor: number;
  height?: number;
  scopeLabel?: string;
  consumers?: Consumer[];
  showScopes?: boolean;
  filter?: string;
  model?: RepoModel;
  env?: string;
  // When set, the list is split into group buckets with header rows; `cursor` is
  // still a variable index (the display order matches grouping's orderedVariables).
  grouped?: boolean;
}) {
  // Rows interleave group headers with variables. Windowing operates on rows so a
  // header occupies a line; the cursor (a variable index) maps to its var row.
  const rows = groupedRows(variables, grouped);
  const selectedRow = Math.max(0, rows.findIndex((r) => r.kind === "var" && r.index === cursor));
  const maxItems = height ? Math.max(0, height - 5) : rows.length;
  const windowed = listWindow(rows, selectedRow, maxItems);

  const valueFor = (v: Variable) => (model && env ? valueOf(model, v.id, env) : "");
  // The text shown in the value column: the placeholder for an unset value (a secret
  // with no value has nothing to mask), the mask for a secret with a value, otherwise
  // the value itself.
  const displayValueOf = (v: Variable) => {
    const value = valueFor(v);
    if (value === "") return EMPTY_LABEL;
    return v.secret ? SECRET_MASK : value;
  };
  const isEmptyValue = (v: Variable) => valueFor(v) === "";
  const hintFor = (v: Variable) => (showScopes && consumers ? wireHint(v.consumers, consumers) : null);
  // The scopes column shows the variable's wiring (which consumers receive it).
  // Plain text, used for width/fill.
  const scopeTextFor = (v: Variable): string => {
    if (!showScopes) return "";
    return hintFor(v) ?? "";
  };

  // Fixed columns, computed over the whole list so they stay put as the window
  // scrolls: the widest name, and the widest scope cell (so the value column can
  // leave room for it and the scopes line up).
  const nameWidth = variables.length ? Math.max(...variables.map(dispNameLen)) : 0;
  const scopesWidth = variables.length ? Math.max(0, ...variables.map((v) => scopeTextFor(v).length)) : 0;

  // The pane flexes to fill the columns left over by the scope tree and inspector,
  // so its width isn't known until after layout. Measure it to size the value
  // column and to pad each row to the full width (so a selected row's highlight
  // spans the whole row). Until the first measurement lands (rowWidth = 0) the
  // value column falls back to a cap and rows aren't padded, which is harmless.
  const boxRef = useRef<DOMElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    if (!boxRef.current) return;
    // measureElement reports the box's outer width; subtract the round border
    // (1 each side) and paddingX (1 each side) to get the content width.
    const inner = Math.max(0, measureElement(boxRef.current).width - 4);
    if (inner !== rowWidth) setRowWidth(inner);
  });

  // Value column width: the natural width of the values (a masked secret counts as
  // "***"), capped at whatever the line can hold after the name and scope columns
  // and their gutters — so a value too long for the line is truncated, not wrapped.
  const gutters = 3 + (scopesWidth > 0 ? 1 : 0); // lead + after-name + after-value (+ after-scopes)
  const valueRoom = rowWidth > 0 ? Math.max(0, rowWidth - nameWidth - scopesWidth - gutters) : VALUE_FALLBACK_WIDTH;
  const naturalValueWidth = variables.length
    ? Math.max(0, ...variables.map((v) => displayValueOf(v).length))
    : 0;
  const valueWidth = Math.min(valueRoom, naturalValueWidth);

  return (
    <Box ref={boxRef} flexDirection="column" flexGrow={1} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">VARIABLES{scopeLabel ? <Text color="cyan"> · {scopeLabel}</Text> : null}{filter ? <Text color="yellow"> · filter: {filter}</Text> : null}</Text>
      {variables.length === 0 && <Text color="gray">  (none)</Text>}
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((row, i) => {
        if (row.kind === "header") {
          // A real group reads bold; the virtual "Ungrouped" bucket is muted so it
          // recedes behind the named groups.
          return (
            <Text key={`h:${row.label}:${windowed.offset + i}`} wrap="truncate-end">
              {GUTTER}
              {row.muted
                ? <Text color="gray">[{row.label}]</Text>
                : <Text bold color="cyan">[{row.label}]</Text>}
            </Text>
          );
        }
        const v = row.variable;
        const hint = hintFor(v);
        // Name column: name (+ coloured " (local)" suffix), padded to nameWidth
        // between the two gutters. nameSeg width is constant (nameWidth + 2).
        const namePad = Math.max(0, nameWidth - dispNameLen(v));
        const empty = isEmptyValue(v);
        const valueCell = valueWidth > 0 ? truncate(displayValueOf(v), valueWidth).padEnd(valueWidth) : "";
        const scopeLen = scopeTextFor(v).length;
        const contentLen = (nameWidth + 2) + (valueWidth > 0 ? valueCell.length + 1 : 0) + (scopeLen > 0 ? scopeLen + 1 : 0);
        // Trailing fill so a selected row's highlight reaches the pane's right edge.
        const fill = Math.max(0, rowWidth - contentLen);
        // The cursor row is the variable shown in the inspector, so it stays
        // highlighted even when the vars pane isn't focused.
        const isCurrent = row.index === cursor;
        return (
          <Text key={`${v.id}:${row.index}`} backgroundColor={isCurrent ? "gray" : undefined} wrap={rowWidth > 0 ? "truncate" : undefined}>
            {GUTTER}{v.name}{v.local ? <Text color="magenta">{LOCAL_SUFFIX}</Text> : null}{" ".repeat(namePad)}{GUTTER}
            {valueWidth > 0 ? <Text italic={empty} color={empty ? "gray" : v.secret ? "yellow" : undefined}>{valueCell}</Text> : null}
            {valueWidth > 0 ? GUTTER : null}
            {hint ? <Text color="blackBright">{hint}</Text> : null}
            {scopeLen > 0 ? GUTTER : null}
            {fill > 0 ? " ".repeat(fill) : null}
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={rows.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}
