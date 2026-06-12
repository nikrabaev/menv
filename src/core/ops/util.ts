import type { ConsumerDef, GroupDef, Registry, VariableDef, VaultDef } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { Plan } from "../plan.ts";
import { emptyPlan } from "../plan.ts";

// Shared shape of every op planner: the would-be next registry plus the Plan
// describing it. Ops never mutate their input and never do I/O.
export interface OpResult {
  next: Registry;
  plan: Plan;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function cloneRegistry(r: Registry): Registry {
  return structuredClone(r);
}

export function newPlan(): Plan {
  return emptyPlan();
}

const known = (names: string[]) => (names.length > 0 ? names.sort().join(", ") : "none");

export function requireVault(r: Registry, name: string): VaultDef {
  const v = r.vaults[name];
  if (v === undefined) {
    throw new MenvError("NOT_FOUND", `unknown vault "${name}" (known: ${known(Object.keys(r.vaults))})`);
  }
  return v;
}

export function requireConsumer(r: Registry, name: string): ConsumerDef {
  const c = r.consumers[name];
  if (c === undefined) {
    throw new MenvError("NOT_FOUND", `unknown consumer "${name}" (known: ${known(Object.keys(r.consumers))})`);
  }
  return c;
}

export function requireGroup(r: Registry, key: string): GroupDef {
  const g = r.groups[key];
  if (g === undefined) {
    throw new MenvError("NOT_FOUND", `unknown group "${key}" (known: ${known(Object.keys(r.groups))})`);
  }
  return g;
}

export function requireVariable(r: Registry, name: string): VariableDef {
  const v = r.variables[name];
  if (v === undefined) {
    throw new MenvError("NOT_FOUND", `unknown variable "${name}" (known: ${known(Object.keys(r.variables))})`);
  }
  return v;
}

export function requireSlug(kind: string, name: string): void {
  if (!SLUG_RE.test(name)) {
    throw new MenvError("VALIDATION", `invalid ${kind} name "${name}" (use a-z 0-9 . _ -)`);
  }
}
