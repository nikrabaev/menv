import React, { useEffect, useRef, useState } from "react";
import { Box, Text, measureElement, type DOMElement } from "ink";
import type { Consumer, Variable } from "../../core/types.ts";
import { listWindow } from "./listWindow.ts";
import { MoreIndicator } from "./MoreIndicator.tsx";

const MAX_SCOPE_SHOWN = 3;
// A single-cell glyph stands in for the old "[secret]" tag. It must be width-1 in
// every terminal: emoji (e.g. 🔒) render two cells in some terminals and one in
// others, which `string-width` can't predict, so `padEnd` would misalign the
// scopes column. A plain ASCII marker is unambiguous everywhere.
const SECRET_ICON = "*";
const GUTTER = " ";

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

export function VariableList({ variables, cursor, active = true, height, scopeLabel, consumers, showScopes, filter }: {
  variables: Variable[];
  cursor: number;
  active?: boolean;
  height?: number;
  scopeLabel?: string;
  consumers?: Consumer[];
  showScopes?: boolean;
  filter?: string;
}) {
  const maxItems = height ? Math.max(0, height - 5) : variables.length;
  const windowed = listWindow(variables, cursor, maxItems);
  // Column 1 width: widest name in the current list, so the secret/scopes
  // columns line up. Stable across the window since it's computed over all rows.
  const nameWidth = variables.length ? Math.max(...variables.map((v) => v.name.length)) : 0;

  // The pane flexes to fill the columns left over by the scope tree and inspector,
  // so its width isn't known until after layout. Measure it and pad every row to
  // that inner width so a selected row's inverse highlight spans the whole row,
  // not just the cells that hold text. Until the first measurement lands
  // (rowWidth = 0) rows simply aren't padded, which is harmless.
  const boxRef = useRef<DOMElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    if (!boxRef.current) return;
    // measureElement reports the box's outer width; subtract the round border
    // (1 each side) and paddingX (1 each side) to get the content width.
    const inner = Math.max(0, measureElement(boxRef.current).width - 4);
    if (inner !== rowWidth) setRowWidth(inner);
  });

  return (
    <Box ref={boxRef} flexDirection="column" flexGrow={1} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">VARIABLES{scopeLabel ? <Text color="cyan"> · {scopeLabel}</Text> : null}{filter ? <Text color="yellow"> · filter: {filter}</Text> : null}</Text>
      {variables.length === 0 && <Text color="gray">  (none)</Text>}
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((v, i) => {
        const idx = windowed.offset + i;
        const hint = showScopes && consumers ? wireHint(v.consumers, consumers) : null;
        // Pad the name so the secret/scopes columns line up across rows.
        const name = hint || v.secret ? v.name.padEnd(nameWidth) : v.name;
        const secretText = v.secret ? SECRET_ICON : "";
        const secret = hint ? secretText.padEnd(SECRET_ICON.length) : secretText;
        const nameSeg = GUTTER + name + GUTTER;
        const secretSeg = secret || "";
        const hintSeg = hint ? GUTTER + hint + GUTTER : "";
        // Trailing fill so a selected row's highlight reaches the pane's right edge.
        const fill = Math.max(0, rowWidth - (nameSeg.length + secretSeg.length + hintSeg.length));
        const isCurrent = active && idx === cursor;
        return (
          <Text key={`${v.id}:${idx}`} backgroundColor={isCurrent ? 'gray' : ''}>
            {secretSeg ? <Text color="yellow">{secretSeg}</Text> : null}
            {nameSeg}
            {hintSeg ? <Text color="blackBright">{hintSeg}</Text> : null}
            {fill > 0 ? " ".repeat(fill) : null}
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={variables.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}
