import React from "react";
import { Box, Text } from "ink";
import type { Scope } from "../scopes.ts";
import { listWindow } from "./listWindow.ts";

export function ScopeTree({ scopes, cursor, active = true, height }: { scopes: Scope[]; cursor: number; active?: boolean; height?: number }) {
  const maxItems = height ? Math.max(0, height - 5) : scopes.length;
  const windowed = listWindow(scopes, cursor, maxItems);
  return (
    <Box flexDirection="column" width={40} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">SCOPES</Text>
      {windowed.offset > 0 && <Text color="gray">  ...</Text>}
      {windowed.items.map((s, i) => {
        const idx = windowed.offset + i;
        if (s.kind === "header") {
          return (
            <Text key={`${s.id}:${idx}`} color="gray" bold>
              {s.label}
            </Text>
          );
        }
        return (
          <Text key={`${s.id}:${idx}`} inverse={active && idx === cursor}>
            {"  " + s.label}
          </Text>
        );
      })}
      {windowed.offset + windowed.items.length < scopes.length && <Text color="gray">  ...</Text>}
    </Box>
  );
}
