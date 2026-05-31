import React from "react";
import { Box, Text } from "ink";
import type { RepoModel, Variable } from "../../core/types.ts";
import { inspectorFields, type InspectorField } from "../inspectorFields.ts";
import { listWindow } from "./listWindow.ts";
import { MoreIndicator } from "./MoreIndicator.tsx";

const SECRET_MASK = "***";

// Truncates to `width` cells, marking the cut with a single-cell ellipsis.
function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return text.slice(0, width - 1) + "…";
}

function displayText(f: InspectorField): string {
  switch (f.kind) {
    case "secret": return f.on ? "yes" : "no";
    case "wiring": return f.summary || "-";
    case "group": return f.text || "-";
    case "value": return f.secret ? SECRET_MASK : f.text;
    case "description":
    case "example":
      return f.text;
  }
}

export function Inspector({ model, variable, active = false, cursor = 0, height }: {
  model: RepoModel;
  variable: Variable | null;
  active?: boolean;
  cursor?: number;
  height?: number;
}) {
  if (!variable) {
    return (
      <Box flexDirection="column" width={60} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">select a variable</Text>
      </Box>
    );
  }
  const fields = inspectorFields(model, variable);
  const labelWidth = fields.length ? Math.max(...fields.map((f) => f.label.length)) : 0;
  // Inner content width is 56 (box 60 − border 2 − paddingX 2). The value column gets
  // what's left after the 2-cell caret/indent, the label, and one gutter cell.
  const valueWidth = Math.max(0, 56 - 2 - labelWidth - 1);
  // Title(1) + 2 borders + 2 overflow-marker rows = 5 rows of chrome; the rest hold
  // fields. listWindow keeps the selected field visible and reclaims marker rows when
  // a side has nothing hidden (see listWindow's contract).
  const maxItems = height ? Math.max(0, height - 5) : fields.length;
  const windowed = listWindow(fields, cursor, maxItems);
  return (
    <Box flexDirection="column" width={60} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>{variable.name} <Text color="cyan">· {variable.tier}</Text></Text>
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((f, i) => {
        const idx = windowed.offset + i;
        const isCurrent = active && idx === cursor;
        const masked = f.kind === "value" && f.secret;
        const empty = f.kind === "value" && !f.secret && f.text === "";
        return (
          <Text key={`${f.label}:${idx}`} backgroundColor={isCurrent ? "gray" : undefined}>
            {isCurrent ? "▸ " : "  "}
            <Text color="gray">{f.label.padEnd(labelWidth)}</Text>{" "}
            {empty
              ? <Text italic color="gray">empty</Text>
              : <Text color={masked ? "yellow" : undefined}>{truncate(displayText(f), valueWidth)}</Text>}
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={fields.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}
