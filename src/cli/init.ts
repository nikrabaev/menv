import { join } from "node:path";
import { scanRepo } from "../io/discovery.ts";
import { saveModel } from "../store/save.ts";
import { loadOrCreateIdentity, type KeyBackend, keychainBackend } from "../crypto/identity.ts";

const GITIGNORE_BLOCK = [
  "# menv",
  ".menv/values/",
  ".menv/backups/",
  ".env",
  ".env.*",
  "!.env.example",
].join("\n");

async function ensureGitignore(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  if (existing.includes(".menv/values/")) return;
  await Bun.write(path, existing + (existing.endsWith("\n") || existing === "" ? "" : "\n") + GITIGNORE_BLOCK + "\n");
}

export interface InitOpts {
  backend?: KeyBackend;
  stamp?: string;
}

export async function runInit(root: string, opts: InitOpts = {}): Promise<void> {
  const { model, valuesByEnv } = await scanRepo(root);
  const kp = await loadOrCreateIdentity(opts.backend ?? keychainBackend);
  model.recipients = [kp.recipient];

  const byName = new Map(model.variables.map((v) => [v.name, v.id]));
  for (const [env, named] of Object.entries(valuesByEnv)) {
    for (const [name, val] of Object.entries(named)) {
      const id = byName.get(name);
      if (id) (model.values[id] ??= {})[env] = val;
    }
  }

  await saveModel(model, opts.stamp ?? `init-${model.environments[0]?.id ?? "dev"}`);
  await ensureGitignore(root);
}
