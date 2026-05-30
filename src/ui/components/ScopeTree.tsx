import React from "react";
import { Box, Text } from "ink";
import type { RepoModel } from "../../core/types.ts";
import { listWindow } from "./listWindow.ts";

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

export function ScopeTree({ scopes, cursor, active = true, height }: { scopes: Scope[]; cursor: number; active?: boolean; height?: number }) {
  const maxItems = height ? Math.max(0, height - 5) : scopes.length;
  const windowed = listWindow(scopes, cursor, maxItems);
  return (
    <Box flexDirection="column" width={40} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">SCOPES</Text>
      {windowed.offset > 0 && <Text color="gray">  ...</Text>}
      {windowed.items.map((s, i) => (
        <Text key={`${s.id}:${windowed.offset + i}`} inverse={active && windowed.offset + i === cursor}>{s.label}</Text>
      ))}
      {windowed.offset + windowed.items.length < scopes.length && <Text color="gray">  ...</Text>}
    </Box>
  );
}
