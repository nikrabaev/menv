import type { Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, newPlan, requireConsumer, requireVariable, requireVault } from "./util.ts";

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

export interface SetUniqueValueInput {
  name: string;
  vault: string;
  consumer: string;
  value: string;
  newKey: () => string; // injected (crypto.randomUUID in production) for deterministic tests
}

// Give ONE consumer its own value. If it currently shares its vault key with
// other consumers, re-key it onto a fresh private key first (registry change),
// then write the value there — the other sharers keep the old key/value, so
// the old key is never written nor orphaned. A consumer that already owns its
// key needs no re-key: the registry is untouched and we set the existing key.
export function planSetUniqueValue(registry: Registry, input: SetUniqueValueInput): OpResult {
  const def = requireVariable(registry, input.name);
  requireVault(registry, input.vault);
  requireConsumer(registry, input.consumer);
  const mapping = def.vaultMapping[input.vault] ?? {};
  const entry = mapping[input.consumer];
  if (entry === undefined) {
    throw new MenvError(
      "NOT_FOUND",
      `"${input.name}" is not wired to "${input.consumer}" in vault "${input.vault}"`,
    );
  }
  const shared = Object.entries(mapping).some(([c, e]) => c !== input.consumer && e.key === entry.key);
  const plan = newPlan();
  let key = entry.key;
  let next = registry;
  if (shared) {
    next = cloneRegistry(registry);
    key = input.newKey();
    const nextEntry = next.variables[input.name]?.vaultMapping[input.vault]?.[input.consumer];
    if (nextEntry !== undefined) nextEntry.key = key;
    plan.registry.push({
      action: "set",
      path: `variables.${input.name}.vaultMapping.${input.vault}.${input.consumer}.key`,
      summary: `isolate "${input.name}" for "${input.consumer}" onto a private key (vault "${input.vault}")`,
    });
  }
  plan.vaults.push({ vault: input.vault, action: "set", key, value: input.value });
  return { next, plan };
}
