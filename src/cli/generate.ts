import { loadRepo } from "../store/load.ts";
import { writeGeneratedFiles } from "../io/generate.ts";
import { resolveBackend } from "../crypto/resolveBackend.ts";
import { readKeyBackendConfig } from "../io/persist.ts";
import type { KeyBackend } from "../crypto/identity.ts";

export interface GenerateOpts {
  backend?: KeyBackend;
  env?: string;
  stamp?: string;
}

export async function runGenerate(root: string, opts: GenerateOpts = {}): Promise<string[]> {
  // Headless path: resolve the backend the repo was initialized with and read the
  // identity (the password backend takes its passphrase from MENV_PASSPHRASE). We
  // never *create* here — a missing identity means the repo isn't set up.
  const backend = opts.backend ?? resolveBackend(await readKeyBackendConfig(root), { root, interactive: false });
  const identity = await backend.get();
  if (!identity) {
    throw new Error("menv: no identity found for this repo's key backend — run `menv init` first");
  }
  const model = await loadRepo(root, identity);
  if (opts.env && !model.environments.some((e) => e.id === opts.env)) {
    throw new Error(`unknown environment "${opts.env}" (have: ${model.environments.map((e) => e.id).join(", ")})`);
  }
  // No --env: materialize the default environment (the local TUI uses its selection).
  const env = opts.env ?? model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev";
  return await writeGeneratedFiles(model, env, opts.stamp ?? "generate");
}
