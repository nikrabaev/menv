import { createStore } from "../store/store.ts";
import { saveModel } from "../store/save.ts";
import { loadModel, defaultEnv, resolveVar } from "./context.ts";
import type { KeyBackend } from "../crypto/identity.ts";

export interface RmOpts {
  backend?: KeyBackend;
  scope?: string; // disambiguates when several variables share the name
  local?: boolean; // target the `.env.local` override of NAME rather than the base
  env?: string;
  stamp?: string;
}

// Delete a variable (and its values) from the manifest/vault.
export async function runRm(root: string, name: string, opts: RmOpts = {}): Promise<void> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const v = resolveVar(model, name, { scope: opts.scope, local: opts.local });
  const store = createStore(model);
  store.deleteVariable(v.id);
  await saveModel(store.getModel(), defaultEnv(model, opts.env), opts.stamp ?? "rm");
}
