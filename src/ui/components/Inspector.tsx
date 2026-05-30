import React from "react";
import { Box, Text } from "ink";
import type { RepoModel, Variable } from "../../core/types.ts";
import { valueOf } from "../../core/model.ts";

function display(v: Variable, raw: string): string {
  if (!raw) return "- not set";
  return v.secret ? "*".repeat(Math.min(raw.length, 8)) : raw;
}

export function Inspector({ model, variable, env, height }: { model: RepoModel; variable: Variable | null; env: string; height?: number }) {
  if (!variable) {
    return (
      <Box flexDirection="column" width={60} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">select a variable</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" width={60} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>{variable.name}</Text>
      {variable.description ? <Text color="gray">{variable.description}</Text> : null}
      <Text>tier  <Text color="cyan">{variable.tier}</Text></Text>
      <Text>group <Text color="magenta">{variable.group ?? "-"}</Text></Text>
      <Text>secret {variable.secret ? "yes" : "no"}</Text>
      <Text>used  <Text color="green">{variable.consumers.join(", ") || "-"}</Text></Text>
      <Text color="gray">-- values by env --</Text>
      {model.environments.map((e) => (
        <Text key={e.id}>
          <Text color={e.id === env ? "cyan" : undefined}>{e.id.padEnd(8)}</Text>
          {display(variable, valueOf(model, variable.id, e.id))}
        </Text>
      ))}
    </Box>
  );
}
