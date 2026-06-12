import type { Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { OpResult } from "./util.ts";
import { newPlan, requireVariable, requireVault } from "./util.ts";

export interface KeyQuery {
  name: string;
  vault: string;
  consumer?: string;
}

// --consumer is only needed when consumers hold different keys in this vault;
// a single shared key is unambiguous. Ambiguity is an error listing the
// options, never a guess (spec: "Repeated names" rule, v2 form).
export function resolveMappingKey(registry: Registry, q: KeyQuery): { key: string; consumers: string[] } {
  const def = requireVariable(registry, q.name);
  requireVault(registry, q.vault);
  const mapping = def.vaultMapping[q.vault];
  if (mapping === undefined || Object.keys(mapping).length === 0) {
    throw new MenvError("NOT_FOUND", `"${q.name}" is not wired to any consumer in vault "${q.vault}"`);
  }
  if (q.consumer !== undefined) {
    const entry = mapping[q.consumer];
    if (entry === undefined) {
      throw new MenvError("NOT_FOUND", `"${q.name}" is not wired to "${q.consumer}" in vault "${q.vault}"`);
    }
    return { key: entry.key, consumers: [q.consumer] };
  }
  const byKey = new Map<string, string[]>();
  for (const [consumer, entry] of Object.entries(mapping)) {
    byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), consumer]);
  }
  if (byKey.size === 1) {
    const [key, consumers] = [...byKey.entries()][0] as [string, string[]];
    return { key, consumers };
  }
  const options = [...byKey.values()]
    .map((consumers) => consumers.sort().join("/"))
    .sort()
    .join(", ");
  throw new MenvError(
    "AMBIGUOUS",
    `"${q.name}" holds different values per consumer in vault "${q.vault}" — pass --consumer (one of: ${options})`,
  );
}

export interface SetValueInput extends KeyQuery {
  value: string;
}

// Pure vault write: the registry is untouched, so `next` IS the input. The
// value rides only on the VaultOp (stripped from all rendered output).
export function planSetValue(registry: Registry, input: SetValueInput): OpResult {
  const { key } = resolveMappingKey(registry, input);
  const plan = newPlan();
  plan.vaults.push({ vault: input.vault, action: "set", key, value: input.value });
  return { next: registry, plan };
}
