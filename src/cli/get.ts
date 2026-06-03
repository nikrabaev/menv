import { resolveValue } from "../core/model.ts";
import type { KeyBackend } from "../crypto/identity.ts";
import { defaultEnv, loadModel, resolveVar } from "./context.ts";

export interface GetOpts {
  backend?: KeyBackend;
  env?: string;
  scope?: string; // disambiguates when several variables share the name
  local?: boolean; // target the `.env.local` override of NAME rather than the base
}

// Read a variable's value for an environment. Returns the raw value (secrets
// included) so it pipes cleanly, e.g. `export TOKEN=$(menv get TOKEN)`.
export async function runGet(root: string, name: string, opts: GetOpts = {}): Promise<string> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const v = resolveVar(model, name, { scope: opts.scope, local: opts.local });
  return resolveValue(model, v.id, defaultEnv(model, opts.env));
}
