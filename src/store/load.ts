import { join } from "node:path";
import { readModelFiles } from "../io/persist.ts";
import { loadEnvValues } from "../crypto/vault.ts";
import type { RepoModel, Values } from "../core/types.ts";

export async function loadRepo(root: string, identity: string): Promise<RepoModel> {
  const parts = await readModelFiles(root);
  const byName = new Map(parts.variables.map((v) => [v.name, v.id]));
  const values: Values = {};
  for (const env of parts.environments) {
    const named = await loadEnvValues(root, env.id, identity);
    for (const [name, val] of Object.entries(named)) {
      const id = byName.get(name);
      if (!id) continue;
      (values[id] ??= {})[env.id] = val;
    }
  }
  return {
    root,
    environments: parts.environments,
    variables: parts.variables,
    consumers: parts.consumers,
    values,
    recipients: parts.recipients,
  };
}

export async function isMenvRepo(root: string): Promise<boolean> {
  return await Bun.file(join(root, "menv.toml")).exists();
}
