import type { Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, newPlan } from "./util.ts";

// Registry list management only — marker filling and .env.compose are Plan 3.
// On-disk existence of the file is the CLI layer's check (ops do no I/O).
export function planComposeBind(registry: Registry, input: { file: string }): OpResult {
  if (registry.compose.files.includes(input.file)) {
    throw new MenvError("VALIDATION", `"${input.file}" is already bound`);
  }
  const next = cloneRegistry(registry);
  next.compose.files.push(input.file);
  const plan = newPlan();
  plan.registry.push({ action: "set", path: "compose.files", summary: `bind compose file "${input.file}"` });
  return { next, plan };
}

export function planComposeUnbind(registry: Registry, input: { file: string }): OpResult {
  if (!registry.compose.files.includes(input.file)) {
    throw new MenvError("NOT_FOUND", `"${input.file}" is not bound (bound: ${registry.compose.files.join(", ") || "none"})`);
  }
  const next = cloneRegistry(registry);
  next.compose.files = next.compose.files.filter((f) => f !== input.file);
  const plan = newPlan();
  plan.registry.push({ action: "remove", path: "compose.files", summary: `unbind compose file "${input.file}"` });
  return { next, plan };
}
