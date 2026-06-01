export type EnvId = string;
export type AppId = string;
export type ConsumerId = string;
export type VarId = string;
export type Tier = "global" | "local";

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
  tier: Tier;
  ownerApp?: AppId; // required iff tier === "local"
  description: string;
  group: string | null;
  secret: boolean;
  consumers: ConsumerId[]; // wiring; for local, includes owner app
  example?: string; // optional placeholder emitted into .env.example; one per variable, not per-env
}

export interface Environment {
  id: EnvId;
  isDefault: boolean;
}

export interface AppTarget {
  kind: "app";
  id: AppId;
  name: string;
  path: string; // relative to repo root
  // The single .env file this app gets, relative to its path (canonically ".env").
  // Absent means the app has no env file and is not generated. Values for whichever
  // environment is active are written here; menv never writes per-env files.
  envFile?: string;
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
