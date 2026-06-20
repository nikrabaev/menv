import type { Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, newPlan, requireSlug, requireVault } from "./util.ts";

export interface VaultAddInput {
  name: string;
  vaultType: string;
  vaultConfig: Record<string, unknown>;
}

export function planVaultAdd(registry: Registry, input: VaultAddInput): OpResult {
  requireSlug("vault", input.name);
  if (registry.vaults[input.name] !== undefined) {
    throw new MenvError("VALIDATION", `vault "${input.name}" already exists`);
  }
  const next = cloneRegistry(registry);
  next.vaults[input.name] = { vaultType: input.vaultType, vaultConfig: input.vaultConfig };
  const plan = newPlan();
  plan.registry.push({
    action: "set",
    path: `vaults.${input.name}`,
    summary: `add vault "${input.name}" (${input.vaultType})`,
  });
  return { next, plan };
}

export interface VaultUpdateInput {
  name: string;
  config?: Record<string, unknown>;
  makeDefault?: boolean;
}

export function planVaultUpdate(registry: Registry, input: VaultUpdateInput): OpResult {
  const def = requireVault(registry, input.name);
  const next = cloneRegistry(registry);
  const plan = newPlan();
  if (input.config !== undefined) {
    const base = typeof def.vaultConfig === "object" && def.vaultConfig !== null ? def.vaultConfig : {};
    next.vaults[input.name] = {
      vaultType: def.vaultType,
      vaultConfig: { ...(base as Record<string, unknown>), ...input.config },
    };
    plan.registry.push({
      action: "set",
      path: `vaults.${input.name}.vaultConfig`,
      summary: `update vault "${input.name}" config (${Object.keys(input.config).sort().join(", ")})`,
    });
  }
  if (input.makeDefault === true) {
    next.defaults.vault = input.name;
    plan.registry.push({
      action: "set",
      path: "defaults.vault",
      summary: `make "${input.name}" the default vault`,
    });
  }
  return { next, plan };
}

export interface VaultRemoveInput {
  name: string;
}

// The forced outcome cascades: every vaultMapping[<name>] and globals
// values[<name>] entry is dropped. The vault's backing store is never touched
// (spec: "vault file/store itself is never deleted").
export function planVaultRemove(registry: Registry, input: VaultRemoveInput): OpResult {
  requireVault(registry, input.name);
  if (registry.defaults.vault === input.name) {
    throw new MenvError(
      "VALIDATION",
      `"${input.name}" is the default vault — set another default first (menv vault update <name> --default)`,
    );
  }
  const next = cloneRegistry(registry);
  const plan = newPlan();
  delete next.vaults[input.name];
  plan.registry.push({ action: "remove", path: `vaults.${input.name}`, summary: `remove vault "${input.name}"` });

  for (const [varName, def] of Object.entries(next.variables)) {
    if (def.vaultMapping[input.name] === undefined) continue;
    delete def.vaultMapping[input.name];
    plan.registry.push({
      action: "remove",
      path: `variables.${varName}.vaultMapping.${input.name}`,
      summary: `unmap "${varName}" from vault "${input.name}"`,
    });
    plan.blockers.push({
      code: "VAULT_IN_USE",
      message: `variable "${varName}" is mapped in vault "${input.name}"`,
    });
  }
  for (const [globalName, def] of Object.entries(next.globals)) {
    if (def.values[input.name] === undefined) continue;
    delete def.values[input.name];
    plan.registry.push({
      action: "remove",
      path: `globals.${globalName}.values.${input.name}`,
      summary: `drop global "${globalName}" value for vault "${input.name}"`,
    });
    plan.blockers.push({
      code: "VAULT_IN_USE",
      message: `global "${globalName}" is defined for vault "${input.name}"`,
    });
  }
  return { next, plan };
}
