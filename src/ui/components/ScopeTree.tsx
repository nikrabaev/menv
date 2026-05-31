import React from "react";
import { Box, Text } from "ink";
import type { Scope } from "../scopes.ts";
import { listWindow } from "./listWindow.ts";
import { MoreIndicator } from "./MoreIndicator.tsx";

export function ScopeTree({ scopes, cursor, active = true, height }: { scopes: Scope[]; cursor: number; active?: boolean; height?: number }) {
  const maxItems = height ? Math.max(0, height - 5) : scopes.length;
  const windowed = listWindow(scopes, cursor, maxItems);
  return (
    <Box flexDirection="column" width={40} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">SCOPES</Text>
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((s, i) => {
        const idx = windowed.offset + i;
        if (s.kind === "header") {
          return (
            <Text key={`${s.id}:${idx}`} color="gray" bold>
              {s.label}
            </Text>
          );
        }
        const selected = idx === cursor;
        // Group scopes are shown bracketed to read as group names, distinct from
        // the apps/services/built-in scopes around them.
        const label = s.kind === "group" ? `[${s.label}]` : s.label;
        return (
          <Text key={`${s.id}:${idx}`} inverse={active && selected} color={!active && selected ? "cyan" : undefined}>
            {"  " + label + "  "}
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={scopes.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}
