import type { KeyBackend } from "../crypto/identity.ts";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { defaultEnv, loadModel, resolveVar } from "./context.ts";

export interface SetOpts {
  backend?: KeyBackend;
  env?: string;
  scope?: string; // disambiguates when several variables share the name
  local?: boolean; // target the `.env.local` override of NAME rather than the base
  value?: string; // the resolved value (the dispatcher reads arg/stdin/prompt)
  stamp?: string;
}

// Set a variable's value for an environment. The variable must already be defined.
// `--env` targets the vault write only: generated single-mode `.env` files always
// keep the default environment's values, so setting a prod value from a dev
// machine never flips the local app onto prod. Materializing another environment
// is an explicit act (`menv generate --env <env>`).
export async function runSet(root: string, name: string, opts: SetOpts = {}): Promise<void> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const v = resolveVar(model, name, { scope: opts.scope, local: opts.local });
  const targetEnv = defaultEnv(model, opts.env);
  const store = createStore(model);
  store.setValue(v.id, targetEnv, opts.value ?? "");
  await saveModel(store.getModel(), defaultEnv(model), opts.stamp ?? "set");
}
