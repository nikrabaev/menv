import { loadRepo } from "../store/load.ts";
import { writeGeneratedFiles } from "../io/generate.ts";
import { loadOrCreateIdentity, type KeyBackend, keychainBackend } from "../crypto/identity.ts";

export interface GenerateOpts {
  backend?: KeyBackend;
  env?: string;
  stamp?: string;
}

export async function runGenerate(root: string, opts: GenerateOpts = {}): Promise<string[]> {
  const kp = await loadOrCreateIdentity(opts.backend ?? keychainBackend);
  const model = await loadRepo(root, kp.identity);
  if (opts.env && !model.environments.some((e) => e.id === opts.env)) {
    throw new Error(`unknown environment "${opts.env}" (have: ${model.environments.map((e) => e.id).join(", ")})`);
  }
  // No --env: materialize the default environment (the local TUI uses its selection).
  const env = opts.env ?? model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev";
  return await writeGeneratedFiles(model, env, opts.stamp ?? "generate");
}
