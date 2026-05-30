import React from "react";
import { Box, Text } from "ink";
import type { Consumer, Variable } from "../../core/types.ts";
import { listWindow } from "./listWindow.ts";

const MAX_SCOPE_SHOWN = 3;

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

export function VariableList({ variables, cursor, active = true, height, scopeLabel, consumers, showScopes }: {
  variables: Variable[];
  cursor: number;
  active?: boolean;
  height?: number;
  scopeLabel?: string;
  consumers?: Consumer[];
  showScopes?: boolean;
}) {
  const maxItems = height ? Math.max(0, height - 5) : variables.length;
  const windowed = listWindow(variables, cursor, maxItems);
  return (
    <Box flexDirection="column" flexGrow={1} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">VARIABLES{scopeLabel ? <Text color="cyan"> · {scopeLabel}</Text> : null}</Text>
      {variables.length === 0 && <Text color="gray">  (none)</Text>}
      {windowed.offset > 0 && <Text color="gray">  ...</Text>}
      {windowed.items.map((v, i) => {
        const hint = showScopes && consumers ? wireHint(v.consumers, consumers) : null;
        return (
          <Text key={`${v.id}:${windowed.offset + i}`} inverse={active && windowed.offset + i === cursor}>
            {v.name}
            {v.secret ? <Text color="yellow"> [secret]</Text> : null}
            {hint ? <Text color="gray">  {hint}</Text> : null}
          </Text>
        );
      })}
      {windowed.offset + windowed.items.length < variables.length && <Text color="gray">  ...</Text>}
    </Box>
  );
}
