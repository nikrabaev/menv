import type { KeyBackend } from "../crypto/identity.ts";
import { writeGeneratedFiles } from "../io/generate.ts";
import { defaultEnv, loadModel } from "./context.ts";

export interface GenerateOpts {
  backend?: KeyBackend;
  env?: string;
  stamp?: string;
}

export async function runGenerate(root: string, opts: GenerateOpts = {}): Promise<string[]> {
  // Headless path: resolve the backend the repo was initialized with and read the
  // identity (the password backend takes its passphrase from MENV_PASSPHRASE).
  const { model } = await loadModel(root, { backend: opts.backend });
  // No --env: materialize the default environment (the local TUI uses its selection).
  const env = defaultEnv(model, opts.env);
  return await writeGeneratedFiles(model, env, opts.stamp ?? "generate");
}
