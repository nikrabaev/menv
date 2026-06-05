import type { RepoModel, Variable, Wiring } from "./types.ts";

export function varsForConsumer(model: RepoModel, consumerId: string): Variable[] {
  return model.variables.filter((v) => isWired(v, consumerId));
}

// The consumer ids this variable is wired to (order preserved from the wiring list).
export function consumerIdsOf(v: Variable): string[] {
  return v.wiring.map((w) => w.consumer);
}

export function wiringFor(v: Variable, consumerId: string): Wiring | undefined {
  return v.wiring.find((w) => w.consumer === consumerId);
}

export function isWired(v: Variable, consumerId: string): boolean {
  return v.wiring.some((w) => w.consumer === consumerId);
}

// Whether the variable is materialized as a live line (vs commented out) for this
// consumer/env: it must be wired, and `env` must not be in its `unapplied` set.
export function isApplied(v: Variable, consumerId: string, env: string): boolean {
  const w = wiringFor(v, consumerId);
  return !!w && !(w.unapplied ?? []).includes(env);
}

// Whether the variable is applied for at least one of its wired consumers in `env`
// — used by scope-agnostic views (the "all" list) to decide if it reads as live or
// commented. An unwired variable is applied nowhere.
export function isAppliedAnywhere(v: Variable, env: string): boolean {
  return v.wiring.some((w) => !(w.unapplied ?? []).includes(env));
}

export function resolveValue(model: RepoModel, varId: string, env: string): string {
  return model.values[varId]?.[env] ?? "";
}

export function appById(model: RepoModel, id: string) {
  return model.consumers.find((c) => c.id === id && c.kind === "app");
}

// Mint an unused variable id for `name`. Since the same NAME can map to several
// variables (distinct value groups), the first gets `var:NAME` and subsequent
// ones get `var:NAME#2`, `var:NAME#3`, … A local override carries a `.local`
// segment (`var:NAME.local`, then `var:NAME.local#2`, …) so it never collides
// with its base sibling. Names are `[A-Za-z0-9_]+`, so neither `.` nor `#`
// collides with a name. Callers building several ids must add each returned id to
// `usedIds` before the next call.
export function freeVarId(usedIds: Set<string>, name: string, opts?: { local?: boolean }): string {
  const base = `var:${name}${opts?.local ? ".local" : ""}`;
  if (!usedIds.has(base)) return base;
  let n = 2;
  while (usedIds.has(`${base}#${n}`)) n++;
  return `${base}#${n}`;
}
