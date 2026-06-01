import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { DEFAULT_KEY_BACKEND } from "../core/types.ts";
import type { Consumer, Environment, KeyBackendConfig, RepoModel, Variable } from "../core/types.ts";

export function modelToToml(m: RepoModel): { config: string; manifest: string } {
  const config = stringifyToml({
    environments: m.environments.map((e) => e.id),
    default_environment: m.environments.find((e) => e.isDefault)?.id ?? m.environments[0]?.id,
    recipients: m.recipients,
    key_backend: keyBackendToToml(m.keyBackend ?? DEFAULT_KEY_BACKEND),
    apps: m.consumers.filter((c) => c.kind === "app").map((c) => ({
      id: c.id, name: c.name, path: (c as any).path, env_file: (c as any).envFile ?? "",
      env_mode: (c as any).envMode ?? "single",
    })),
  });

  const manifest = stringifyToml({
    variables: m.variables.map((v) => ({
      id: v.id, name: v.name,
      description: v.description, group: v.group ?? "", secret: v.secret, consumers: v.consumers,
      example: v.example ?? "",
    })),
  });

  return { config, manifest };
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

export function tomlToModelParts(config: string, manifest: string): {
  environments: Environment[];
  recipients: string[];
  consumers: Consumer[];
  variables: Variable[];
  keyBackend: KeyBackendConfig;
} {
  const c = parseToml(config) as any;
  const man = parseToml(manifest) as any;

  const defaultEnv = c.default_environment as string;
  const environments: Environment[] = (c.environments as string[]).map((id) => ({
    id, isDefault: id === defaultEnv,
  }));

  const apps: Consumer[] = ((c.apps ?? []) as any[]).map((a) => ({
    kind: "app", id: a.id, name: a.name, path: a.path,
    // Prefer the new single env_file; fall back to legacy env_files (any entry ⇒ ".env").
    envFile: a.env_file || (a.env_files && Object.keys(a.env_files).length ? ".env" : undefined),
    // Absent or anything but "perenv" ⇒ "single" (the pre-modes default).
    envMode: a.env_mode === "perenv" ? "perenv" : "single",
  }));
  // Legacy manifests may still carry `tier` / `owner_app` keys; smol-toml parses
  // them and we simply don't read them — the next save drops them.
  const variables: Variable[] = ((man.variables ?? []) as any[]).map((v) => ({
    id: v.id, name: v.name,
    description: v.description ?? "", group: v.group || null, secret: !!v.secret,
    consumers: v.consumers ?? [], example: v.example || undefined,
  }));

  return {
    environments,
    recipients: (c.recipients ?? []) as string[],
    consumers: [...apps],
    variables,
    keyBackend: parseKeyBackend(c.key_backend),
  };
}

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

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
  const c = parseToml(await Bun.file(join(root, CONFIG_FILE)).text()) as any;
  return parseKeyBackend(c.key_backend);
}
