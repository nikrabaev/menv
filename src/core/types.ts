export type EnvId = string;
export type AppId = string;
export type ConsumerId = string;
export type VarId = string;

// How the secret age identity is stored. The public recipient always lives in
// menv.toml and values are always encrypted to it; only the location of the
// secret half varies by backend.
export type KeyBackendKind = "keychain" | "1password" | "password";

export interface KeyBackendConfig {
  kind: KeyBackendKind;
  // For "1password": the `op://vault/item/field` reference the identity lives at.
  opRef?: string;
}

export interface Variable {
  id: VarId;
  name: string;
  description: string;
  group: string | null;
  secret: boolean;
  // Wiring: which consumers (workspace apps and/or the synthetic "root" target)
  // receive this variable in their generated `.env`. A variable with no consumers
  // is defined in the manifest but materialized nowhere until it is wired.
  consumers: ConsumerId[];
  example?: string; // optional placeholder emitted into .env.example; one per variable, not per-env
}

export interface Environment {
  id: EnvId;
  isDefault: boolean;
}

// How an app's env files are laid out on disk:
//   "single" — one `.env` (canonical) holding the active environment's values.
//   "perenv" — one `.env.<env>` per environment, all written side by side.
// Absent ⇒ "single" (the pre-modes default, matching an old menv.toml).
export type EnvFileMode = "single" | "perenv";

export interface AppTarget {
  kind: "app";
  id: AppId;
  name: string;
  path: string; // relative to repo root
  // In "single" mode this is the .env file the app gets, relative to its path
  // (canonically ".env"). In "perenv" mode the filenames are derived (`.env.<env>`)
  // and this field is purely the "is this app generated" gate. Absent either way
  // means the app has no env file and is not generated.
  envFile?: string;
  envMode?: EnvFileMode; // absent ⇒ "single"
}

export type Consumer = AppTarget;

// values[varId][envId] = value
export type Values = Record<VarId, Record<EnvId, string>>;

export interface RepoModel {
  root: string;
  environments: Environment[];
  variables: Variable[];
  consumers: Consumer[];
  values: Values;
  recipients: string[]; // age public keys
  // How the secret identity is stored. Absent on a freshly scanned model (init
  // chooses it) and treated as `{ kind: "keychain" }` when read — the pre-backends
  // default, matching how an old menv.toml without the field deserializes.
  keyBackend?: KeyBackendConfig;
}

export const DEFAULT_KEY_BACKEND: KeyBackendConfig = { kind: "keychain" };
