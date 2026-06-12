import { freeVarId } from "../core/model.ts";
import type { KeyBackend } from "../crypto/identity.ts";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { defaultEnv, loadModel, resolveConsumer } from "./context.ts";

export interface DefineOpts {
  backend?: KeyBackend;
  secret?: boolean; // true => --secret, false => --no-secret, undefined => leave as-is
  description?: string;
  example?: string;
  group?: string; // "" clears the group
  scope?: string[]; // replaces the consumer set (tokens incl. "root")
  local?: boolean; // create/address the `.env.local` override of NAME rather than the base
  stamp?: string;
}

// Create a variable in the manifest, or update an existing one's metadata/wiring.
// Targets the variable named NAME: creates it if absent, updates it if exactly one
// exists, and refuses if the name is ambiguous (several value groups from `init`).
export async function runDefine(root: string, name: string, opts: DefineOpts = {}): Promise<void> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const store = createStore(model);

  // Base and local overrides of a name are separate variables; `--local` scopes
  // both the lookup and the create so each namespace is addressed on its own (and
  // the base-vs-base ambiguity guard below is unaffected).
  const local = opts.local ?? false;
  const existing = model.variables.filter((v) => v.name === name && (v.local ?? false) === local);
  let id: string;
  if (existing.length === 0) {
    id = freeVarId(new Set(model.variables.map((v) => v.id)), name, { local });
    store.addVariable({ id, name, description: "", group: null, secret: false, wiring: [], ...(local ? { local: true } : {}) });
  } else if (existing.length === 1) {
    id = existing[0]!.id;
  } else {
    throw new Error(
      `menv: "${name}" is ambiguous — ${existing.length} variants exist (${existing.map((v) => v.id).join(", ")}). Edit it in the TUI, or rm and redefine.`,
    );
  }

  // Apply each provided field uniformly for both the create and update paths.
  if (opts.secret !== undefined) store.setSecret(id, opts.secret);
  if (opts.description !== undefined) store.setDescription(id, opts.description);
  if (opts.example !== undefined) store.setExample(id, opts.example);
  if (opts.group !== undefined) store.setGroup(id, opts.group.trim() || null);
  if (opts.scope !== undefined) {
    const ids = opts.scope.map((s) => resolveConsumer(model, s));
    store.setConsumers(id, ids);
    for (const cid of ids) store.ensureEnvFile(cid);
  }

  await saveModel(store.getModel(), defaultEnv(model), opts.stamp ?? "define");
}
