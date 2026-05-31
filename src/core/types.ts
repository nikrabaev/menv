export type EnvId = string;
export type AppId = string;
export type ServiceId = string;
export type ConsumerId = string;
export type VarId = string;
export type Tier = "global" | "local";

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

export interface ServiceTarget {
  kind: "service";
  id: ServiceId;
  name: string;
  composeFile: string; // relative to repo root
  inject: "env_file" | "environment";
  envFileRef?: string; // relative path used when inject === "env_file"
}

export type Consumer = AppTarget | ServiceTarget;

// values[varId][envId] = value
export type Values = Record<VarId, Record<EnvId, string>>;

export interface RepoModel {
  root: string;
  environments: Environment[];
  variables: Variable[];
  consumers: Consumer[];
  values: Values;
  recipients: string[]; // age public keys
}
