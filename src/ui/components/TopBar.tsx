import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";

export function TopBar({ root, env, dirty, unsaved }: { root: string; env: string; dirty: boolean; unsaved: number }) {
  return (
    <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="gray">
      <Text>
        <Text color="green">menv</Text> <Text color="gray">{basename(root)}</Text>
      </Text>
      <Text>
        env <Text color="cyan">[{env}]</Text>
        {dirty ? <Text color="yellow">  * {unsaved} unsaved</Text> : <Text color="gray">  saved</Text>}
      </Text>
    </Box>
  );
}
