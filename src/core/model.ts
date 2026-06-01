import type { RepoModel, Variable } from "./types.ts";

export function varsForConsumer(model: RepoModel, consumerId: string): Variable[] {
  return model.variables.filter((v) => v.consumers.includes(consumerId));
}

export function valueOf(model: RepoModel, varId: string, env: string): string {
  return model.values[varId]?.[env] ?? "";
}

export function appById(model: RepoModel, id: string) {
  return model.consumers.find((c) => c.id === id && c.kind === "app");
}

// Mint an unused variable id for `name`. Since the same NAME can map to several
// variables (distinct value groups), the first gets `var:NAME` and subsequent
// ones get `var:NAME#2`, `var:NAME#3`, … Names are `[A-Za-z0-9_]+`, so `#` never
// collides with a name. Callers building several ids must add each returned id to
// `usedIds` before the next call.
export function freeVarId(usedIds: Set<string>, name: string): string {
  const base = `var:${name}`;
  if (!usedIds.has(base)) return base;
  let n = 2;
  while (usedIds.has(`${base}#${n}`)) n++;
  return `${base}#${n}`;
}
