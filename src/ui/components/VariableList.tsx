import React from "react";
import { Box, Text } from "ink";
import type { Variable } from "../../core/types.ts";
import { listWindow } from "./listWindow.ts";

export function VariableList({ variables, cursor, active = true, height }: { variables: Variable[]; cursor: number; active?: boolean; height?: number }) {
  const maxItems = height ? Math.max(0, height - 5) : variables.length;
  const windowed = listWindow(variables, cursor, maxItems);
  return (
    <Box flexDirection="column" flexGrow={1} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">VARIABLES</Text>
      {variables.length === 0 && <Text color="gray">  (none)</Text>}
      {windowed.offset > 0 && <Text color="gray">  ...</Text>}
      {windowed.items.map((v, i) => (
        <Text key={`${v.id}:${windowed.offset + i}`} inverse={active && windowed.offset + i === cursor}>
          {v.name}
          {v.secret ? <Text color="yellow"> [secret]</Text> : null}
        </Text>
      ))}
      {windowed.offset + windowed.items.length < variables.length && <Text color="gray">  ...</Text>}
    </Box>
  );
}
