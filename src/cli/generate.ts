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
  if (opts.env) model.environments = model.environments.filter((e) => e.id === opts.env);
  return await writeGeneratedFiles(model, opts.stamp ?? "generate");
}
