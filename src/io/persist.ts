import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { Consumer, Environment, KeyBackendConfig, RepoModel, Variable, Wiring } from "../core/types.ts";
import { DEFAULT_KEY_BACKEND } from "../core/types.ts";

export function modelToToml(m: RepoModel): { config: string; manifest: string } {
  const config = stringifyToml({
    environments: m.environments.map((e) => e.id),
    default_environment: m.environments.find((e) => e.isDefault)?.id ?? m.environments[0]?.id,
    recipients: m.recipients,
    key_backend: keyBackendToToml(m.keyBackend ?? DEFAULT_KEY_BACKEND),
    apps: m.consumers.filter((c) => c.kind === "app").map((c) => ({
      id: c.id, name: c.name, path: c.path, env_file: c.envFile ?? "",
      env_mode: c.envMode ?? "single",
    })),
  });

  const manifest = stringifyToml({
    variables: m.variables.map((v) => ({
      id: v.id, name: v.name,
      description: v.description, group: v.group ?? "", secret: v.secret,
      // Each wiring is an inline table; `unapplied` is omitted when empty so the
      // common (applied-everywhere) case stays a bare `{ consumer = "…" }`.
      wiring: v.wiring.map((w) =>
        w.unapplied?.length ? { consumer: w.consumer, unapplied: w.unapplied } : { consumer: w.consumer },
      ),
      example: v.example ?? "", local: v.local ?? false,
    })),
  });

  return { config, manifest };
}

// Build the wiring list from a parsed variable, migrating the legacy flat
// `consumers = [...]` shape (wired and applied everywhere) when `wiring` is absent.
function parseWiring(v: RawVar): Wiring[] {
  if (Array.isArray(v.wiring)) {
    return v.wiring
      .filter((w): w is RawWiring => !!w && typeof w.consumer === "string")
      .map((w) => {
        const unapplied = Array.isArray(w.unapplied) ? w.unapplied.filter((e): e is string => typeof e === "string") : [];
        return unapplied.length ? { consumer: w.consumer, unapplied } : { consumer: w.consumer };
      });
  }
  return (v.consumers ?? []).map((consumer) => ({ consumer }));
}

// Serialize the backend config. `op_ref` is emitted as "" when absent, matching
// how other optional string fields round-trip ("" ⇒ undefined on the way back).
function keyBackendToToml(cfg: KeyBackendConfig): { kind: string; op_ref: string } {
  return { kind: cfg.kind, op_ref: cfg.opRef ?? "" };
}

function parseKeyBackend(raw: unknown): KeyBackendConfig {
  const kb = raw as { kind?: string; op_ref?: string } | undefined;
  if (kb && (kb.kind === "keychain" || kb.kind === "1password" || kb.kind === "password")) {
    return { kind: kb.kind, opRef: kb.op_ref || undefined };
  }
  return DEFAULT_KEY_BACKEND; // absent or unknown ⇒ the pre-backends default
}

// On-disk shapes of the parsed TOML, asserted from the dynamic parser output.
// Optional/legacy fields are modelled in their on-disk (snake_case) form before
// being mapped onto the camelCase domain types below.
interface RawApp {
  id: string;
  name: string;
  path: string;
  env_file?: string;
  env_files?: Record<string, unknown>;
  env_mode?: string;
}
interface RawConfig {
  default_environment: string;
  environments: string[];
  recipients?: string[];
  key_backend?: unknown;
  apps?: RawApp[];
}
interface RawWiring {
  consumer: string;
  unapplied?: string[];
}
interface RawVar {
  id: string;
  name: string;
  description?: string;
  group?: string;
  secret?: unknown;
  wiring?: RawWiring[];
  consumers?: string[]; // legacy: flat wiring list, migrated by parseWiring
  example?: string;
  local?: unknown;
}
interface RawManifest {
  variables?: RawVar[];
}

export function tomlToModelParts(config: string, manifest: string): {
  environments: Environment[];
  recipients: string[];
  consumers: Consumer[];
  variables: Variable[];
  keyBackend: KeyBackendConfig;
} {
  const c = parseToml(config) as unknown as RawConfig;
  const man = parseToml(manifest) as unknown as RawManifest;

  const defaultEnv = c.default_environment;
  const environments: Environment[] = c.environments.map((id) => ({
    id, isDefault: id === defaultEnv,
  }));

  const apps: Consumer[] = (c.apps ?? []).map((a) => ({
    kind: "app", id: a.id, name: a.name, path: a.path,
    // Prefer the new single env_file; fall back to legacy env_files (any entry ⇒ ".env").
    envFile: a.env_file || (a.env_files && Object.keys(a.env_files).length ? ".env" : undefined),
    // Absent or anything but "perenv" ⇒ "single" (the pre-modes default).
    envMode: a.env_mode === "perenv" ? "perenv" : "single",
  }));
  // Legacy manifests may still carry `tier` / `owner_app` keys; smol-toml parses
  // them and we simply don't read them — the next save drops them.
  const variables: Variable[] = (man.variables ?? []).map((v) => ({
    id: v.id, name: v.name,
    description: v.description ?? "", group: v.group || null, secret: !!v.secret,
    wiring: parseWiring(v), example: v.example || undefined,
    local: v.local ? true : undefined,
  }));

  return {
    environments,
    recipients: c.recipients ?? [],
    consumers: [...apps],
    variables,
    keyBackend: parseKeyBackend(c.key_backend),
  };
}

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const CONFIG_FILE = "menv.toml";
export const MANIFEST_FILE = ".menv/manifest.toml";

export async function writeModelFiles(m: RepoModel): Promise<void> {
  const { config, manifest } = modelToToml(m);
  await mkdir(join(m.root, ".menv"), { recursive: true });
  await Bun.write(join(m.root, CONFIG_FILE), config);
  await Bun.write(join(m.root, MANIFEST_FILE), manifest);
}

export async function readModelFiles(root: string) {
  const config = await Bun.file(join(root, CONFIG_FILE)).text();
  const manifest = await Bun.file(join(root, MANIFEST_FILE)).text();
  return tomlToModelParts(config, manifest);
}

// Light read of just the backend config from menv.toml. The generate and TUI
// paths need to construct the backend *before* loading/decrypting the vault.
export async function readKeyBackendConfig(root: string): Promise<KeyBackendConfig> {
  const c = parseToml(await Bun.file(join(root, CONFIG_FILE)).text()) as unknown as RawConfig;
  return parseKeyBackend(c.key_backend);
}
