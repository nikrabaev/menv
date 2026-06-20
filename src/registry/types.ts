// The shape of menv.json (schemaVersion 2). Pure types — validation lives in
// validate.ts, persistence in persist.ts. The registry never contains a value:
// values live in vaults, addressed by the keys in vaultMapping.
export type VaultName = string;
export type ConsumerName = string;
export type GroupKey = string;
export type VariableName = string;

export interface VaultDef {
  vaultType: string;
  // Provider-specific; parsed and validated by the provider (e.g. menv-local
  // expects { filename, encryption }).
  vaultConfig: unknown;
}

export interface SingleStrategyConfig {
  baseDir: string;
  filename: string;
  secretsAsLocalOverrides?: boolean;
  example?: boolean;
}

export interface PerVaultStrategyConfig {
  baseDir: string;
  filenames: Record<VaultName, string>;
  secretsAsLocalOverrides?: boolean;
  example?: boolean;
}

export type ConsumerDef =
  | { strategyType: "single"; strategyConfig: SingleStrategyConfig }
  | { strategyType: "per-vault"; strategyConfig: PerVaultStrategyConfig };

export interface GroupDef {
  title: string;
}

export type GlobalValueDef = { source: "runtime" } | { source: "static"; value: string };

export interface GlobalDef {
  description?: string;
  values: Record<VaultName, GlobalValueDef>;
}

export interface MappingEntry {
  key: string;
  disabled?: boolean;
}

export interface VariableDef {
  groupKey?: GroupKey;
  secret?: boolean;
  description?: string;
  example?: string;
  vaultMapping: Record<VaultName, Record<ConsumerName, MappingEntry>>;
}

export interface Registry {
  schemaVersion: 2;
  defaults: { vault: VaultName };
  vaults: Record<VaultName, VaultDef>;
  consumers: Record<ConsumerName, ConsumerDef>;
  groups: Record<GroupKey, GroupDef>;
  globals: Record<string, GlobalDef>;
  variables: Record<VariableName, VariableDef>;
  compose: { files: string[] };
}
