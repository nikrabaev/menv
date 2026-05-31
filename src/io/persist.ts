import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { Consumer, Environment, RepoModel, Variable } from "../core/types.ts";

export function modelToToml(m: RepoModel): { config: string; manifest: string } {
  const config = stringifyToml({
    environments: m.environments.map((e) => e.id),
    default_environment: m.environments.find((e) => e.isDefault)?.id ?? m.environments[0]?.id,
    recipients: m.recipients,
    apps: m.consumers.filter((c) => c.kind === "app").map((c) => ({
      id: c.id, name: c.name, path: (c as any).path, env_file: (c as any).envFile ?? "",
    })),
    services: m.consumers.filter((c) => c.kind === "service").map((c) => ({
      id: c.id, name: c.name, compose_file: (c as any).composeFile,
      inject: (c as any).inject, env_file_ref: (c as any).envFileRef ?? "",
    })),
  });

  const manifest = stringifyToml({
    variables: m.variables.map((v) => ({
      id: v.id, name: v.name, tier: v.tier, owner_app: v.ownerApp ?? "",
      description: v.description, group: v.group ?? "", secret: v.secret, consumers: v.consumers,
      example: v.example ?? "",
    })),
  });

  return { config, manifest };
}

export function tomlToModelParts(config: string, manifest: string): {
  environments: Environment[];
  recipients: string[];
  consumers: Consumer[];
  variables: Variable[];
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
  }));
  const services: Consumer[] = ((c.services ?? []) as any[]).map((s) => ({
    kind: "service", id: s.id, name: s.name, composeFile: s.compose_file,
    inject: s.inject, envFileRef: s.env_file_ref || undefined,
  }));

  const variables: Variable[] = ((man.variables ?? []) as any[]).map((v) => ({
    id: v.id, name: v.name, tier: v.tier, ownerApp: v.owner_app || undefined,
    description: v.description ?? "", group: v.group || null, secret: !!v.secret,
    consumers: v.consumers ?? [], example: v.example || undefined,
  }));

  return { environments, recipients: (c.recipients ?? []) as string[], consumers: [...apps, ...services], variables };
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
