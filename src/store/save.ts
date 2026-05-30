import { join } from "node:path";
import { writeModelFiles } from "../io/persist.ts";
import { saveEnvValues } from "../crypto/vault.ts";
import { writeGeneratedFiles } from "../io/generate.ts";
import { ensureServiceEnvFile } from "../io/compose.ts";
import type { RepoModel } from "../core/types.ts";

export interface SaveSummary {
  files: string[];
}

function envValuesByName(model: RepoModel, env: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of model.variables) {
    const val = model.values[v.id]?.[env];
    if (val !== undefined) out[v.name] = val;
  }
  return out;
}

export async function saveModel(model: RepoModel, stamp: string): Promise<SaveSummary> {
  const files: string[] = [];

  await writeModelFiles(model);
  files.push("menv.toml", ".menv/manifest.toml");

  for (const env of model.environments) {
    await saveEnvValues(model.root, env.id, envValuesByName(model, env.id), model.recipients);
    files.push(`.menv/values/${env.id}.env.age`);
  }

  files.push(...(await writeGeneratedFiles(model, stamp)));

  for (const c of model.consumers) {
    if (c.kind !== "service" || c.inject !== "env_file" || !c.envFileRef) continue;
    const composePath = join(model.root, c.composeFile);
    const text = await Bun.file(composePath).text();
    const next = ensureServiceEnvFile(text, c.name, c.envFileRef);
    if (next !== text) {
      await Bun.write(composePath, next);
      files.push(c.composeFile);
    }
  }

  return { files };
}
