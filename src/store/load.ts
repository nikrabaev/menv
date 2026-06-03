import { join } from "node:path";
import type { RepoModel, Values } from "../core/types.ts";
import { loadEnvValues } from "../crypto/vault.ts";
import { readModelFiles } from "../io/persist.ts";

export async function loadRepo(root: string, identity: string): Promise<RepoModel> {
  const parts = await readModelFiles(root);
  const ids = new Set(parts.variables.map((v) => v.id));
  const values: Values = {};
  for (const env of parts.environments) {
    const byId = await loadEnvValues(root, env.id, identity);
    for (const [id, val] of Object.entries(byId)) {
      if (!ids.has(id)) continue;
      values[id] ??= {};
      values[id][env.id] = val;
    }
  }
  return {
    root,
    environments: parts.environments,
    variables: parts.variables,
    consumers: parts.consumers,
    values,
    recipients: parts.recipients,
    keyBackend: parts.keyBackend,
  };
}

export async function isMenvRepo(root: string): Promise<boolean> {
  return await Bun.file(join(root, "menv.toml")).exists();
}
