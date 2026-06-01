import type { RepoModel, Variable } from "../core/types.ts";

export type ScopeKind = "all" | "app" | "group" | "header";

export interface Scope {
  id: string;
  label: string;
  kind: ScopeKind;
  tag?: string; // small dimmed suffix, e.g. "per-env" on an app in perenv mode
}

export function isSelectable(scope: Scope): boolean {
  return scope.kind !== "header";
}

export function buildScopes(model: RepoModel): Scope[] {
  const scopes: Scope[] = [{ id: "all", label: "All", kind: "all" }];

  const hasVars = (id: string) => model.variables.some((v) => v.consumers.includes(id));

  const apps = model.consumers.filter((c) => c.kind === "app" && hasVars(c.id));
  if (apps.length) {
    scopes.push({ id: "header:apps", label: "TARGETS", kind: "header" });
    for (const c of apps) {
      scopes.push({ id: c.id, label: c.name, kind: "app", tag: c.envMode === "perenv" ? "per-env" : undefined });
    }
  }

  const groups = [...new Set(model.variables.map((v) => v.group).filter(Boolean))] as string[];
  if (groups.length) {
    scopes.push({ id: "header:groups", label: "GROUPS", kind: "header" });
    for (const g of groups) scopes.push({ id: `group:${g}`, label: g, kind: "group" });
  }

  return scopes;
}

// Precondition: `scopeId` identifies a SELECTABLE scope (all/group/consumer).
// Header ids (e.g. "header:apps") should never reach this function — navigation
// skips header rows — and would fall through to the consumer branch returning [].
export function varsForScope(model: RepoModel, scopeId: string): Variable[] {
  if (scopeId === "all") return model.variables;
  if (scopeId.startsWith("group:")) {
    const g = scopeId.slice("group:".length);
    return model.variables.filter((v) => v.group === g);
  }
  return model.variables.filter((v) => v.consumers.includes(scopeId));
}

// Returns the next selectable index in direction `dir`, skipping header rows.
// Clamps: if there is no selectable row that way, returns `from` unchanged.
export function stepScope(scopes: Scope[], from: number, dir: 1 | -1): number {
  let i = from + dir;
  while (i >= 0 && i < scopes.length && !isSelectable(scopes[i])) i += dir;
  if (i < 0 || i >= scopes.length) return from;
  return i;
}
