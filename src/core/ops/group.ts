import type { Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, newPlan, requireGroup, requireSlug } from "./util.ts";

export function planGroupAdd(registry: Registry, input: { key: string; title: string }): OpResult {
  requireSlug("group", input.key);
  if (registry.groups[input.key] !== undefined) {
    throw new MenvError("VALIDATION", `group "${input.key}" already exists`);
  }
  const next = cloneRegistry(registry);
  next.groups[input.key] = { title: input.title };
  const plan = newPlan();
  plan.registry.push({ action: "set", path: `groups.${input.key}`, summary: `add group "${input.key}"` });
  return { next, plan };
}

export function planGroupUpdate(registry: Registry, input: { key: string; title: string }): OpResult {
  requireGroup(registry, input.key);
  const next = cloneRegistry(registry);
  next.groups[input.key] = { title: input.title };
  const plan = newPlan();
  plan.registry.push({
    action: "set",
    path: `groups.${input.key}.title`,
    summary: `retitle group "${input.key}"`,
  });
  return { next, plan };
}

// Forced outcome: members lose their groupKey (spec's removal table).
export function planGroupRemove(registry: Registry, input: { key: string }): OpResult {
  requireGroup(registry, input.key);
  const next = cloneRegistry(registry);
  const plan = newPlan();
  delete next.groups[input.key];
  plan.registry.push({ action: "remove", path: `groups.${input.key}`, summary: `remove group "${input.key}"` });
  for (const [varName, def] of Object.entries(next.variables)) {
    if (def.groupKey !== input.key) continue;
    def.groupKey = undefined;
    plan.registry.push({
      action: "remove",
      path: `variables.${varName}.groupKey`,
      summary: `clear group on "${varName}"`,
    });
    plan.blockers.push({ code: "GROUP_IN_USE", message: `variable "${varName}" is in group "${input.key}"` });
  }
  return { next, plan };
}
