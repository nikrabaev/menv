// The public vault-plugin contract (spec: "Modular vaults"). v2.0 ships one
// provider (menv-local); adding another must require zero changes outside the
// provider module and the registry map in vault/registry.ts.

// Resolved auth material for one vault. Provider-interpreted: for menv-local
// `secret` is the encryption passphrase; a future remote provider would read
// its token from here.
export interface VaultAuth {
  secret?: string;
}

export interface VaultInitContext {
  // Repo root — providers resolve repo-relative paths (e.g. menv-local's
  // vaultConfig.filename) against this.
  root: string;
  auth: VaultAuth;
}

export interface VaultSession {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
  close(): Promise<void>;
}

export interface VaultProvider {
  readonly type: string;
  init(config: unknown, ctx: VaultInitContext): Promise<VaultSession>;
}
