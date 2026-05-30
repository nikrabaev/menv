import React from "react";
import { Box, Text } from "ink";
import type { Variable } from "../../core/types.ts";

export function VariableList({ variables, cursor }: { variables: Variable[]; cursor: number }) {
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">VARIABLES</Text>
      {variables.length === 0 && <Text color="gray">  (none)</Text>}
      {variables.map((v, i) => (
        <Text key={v.id} inverse={i === cursor}>
          {v.name}
          {v.secret ? <Text color="yellow"> [secret]</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
