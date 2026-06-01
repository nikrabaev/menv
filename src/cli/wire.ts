import { createStore } from "../store/store.ts";
import { saveModel } from "../store/save.ts";
import { loadModel, defaultEnv, resolveVar, resolveConsumer } from "./context.ts";
import type { KeyBackend } from "../crypto/identity.ts";

export interface WireOpts {
  backend?: KeyBackend;
  env?: string;
  stamp?: string;
}

async function applyWire(
  root: string,
  name: string,
  scopes: string[],
  on: boolean,
  opts: WireOpts,
): Promise<void> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const v = resolveVar(model, name);
  const store = createStore(model);
  for (const s of scopes) {
    const cid = resolveConsumer(model, s);
    store.wire(v.id, cid, on);
    if (on) store.ensureEnvFile(cid);
  }
  await saveModel(store.getModel(), defaultEnv(model, opts.env), opts.stamp ?? (on ? "wire" : "unwire"));
}

// Wire a variable to one or more consumers (apps and/or "root"), so each receives
// it in its generated `.env`.
export function runWire(root: string, name: string, scopes: string[], opts: WireOpts = {}): Promise<void> {
  return applyWire(root, name, scopes, true, opts);
}

// Remove a variable from one or more consumers.
export function runUnwire(root: string, name: string, scopes: string[], opts: WireOpts = {}): Promise<void> {
  return applyWire(root, name, scopes, false, opts);
}
