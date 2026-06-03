import type { RepoModel } from "../core/types.ts";
import { saveEnvValues } from "../crypto/vault.ts";
import { writeGeneratedFiles } from "../io/generate.ts";
import { writeModelFiles } from "../io/persist.ts";

export interface SaveSummary {
  files: string[];
}

function envValuesById(model: RepoModel, env: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of model.variables) {
    const val = model.values[v.id]?.[env];
    if (val !== undefined) out[v.id] = val;
  }
  return out;
}

// `env` is the active environment whose values are materialized into each app's
// `.env`. All environments' encrypted values are still written to the vault.
export async function saveModel(model: RepoModel, env: string, stamp: string): Promise<SaveSummary> {
  const files: string[] = [];

  await writeModelFiles(model);
  files.push("menv.toml", ".menv/manifest.toml");

  for (const e of model.environments) {
    await saveEnvValues(model.root, e.id, envValuesById(model, e.id), model.recipients);
    files.push(`.menv/values/${e.id}.env.age`);
  }

  files.push(...(await writeGeneratedFiles(model, env, stamp)));

  return { files };
}
