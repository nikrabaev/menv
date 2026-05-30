import React from "react";
import { Box, Text } from "ink";
import type { RepoModel } from "../../core/types.ts";

export interface Scope {
  id: string;
  label: string;
  kind: "global" | "app" | "service" | "group";
}

export function buildScopes(model: RepoModel): Scope[] {
  const scopes: Scope[] = [{ id: "global", label: "* Global", kind: "global" }];
  for (const c of model.consumers.filter((c) => c.kind === "app")) scopes.push({ id: c.id, label: `  ${c.name}`, kind: "app" });
  for (const c of model.consumers.filter((c) => c.kind === "service")) scopes.push({ id: c.id, label: `  ${c.name}`, kind: "service" });
  const groups = [...new Set(model.variables.map((v) => v.group).filter(Boolean))] as string[];
  for (const g of groups) scopes.push({ id: `group:${g}`, label: `  ${g}`, kind: "group" });
  return scopes;
}

export function ScopeTree({ scopes, cursor }: { scopes: Scope[]; cursor: number }) {
  return (
    <Box flexDirection="column" width={20} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">SCOPES</Text>
      {scopes.map((s, i) => (
        <Text key={s.id} inverse={i === cursor}>{s.label}</Text>
      ))}
    </Box>
  );
}
