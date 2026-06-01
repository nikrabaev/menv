import { loadRepo } from "../store/load.ts";
import { resolveBackend } from "../crypto/resolveBackend.ts";
import { readKeyBackendConfig } from "../io/persist.ts";
import type { KeyBackend } from "../crypto/identity.ts";
import type { RepoModel, Variable } from "../core/types.ts";

export interface LoadedRepo {
  model: RepoModel;
  backend: KeyBackend;
  identity: string;
}

// Headless load shared by every read/mutate command: resolve the repo's key
// backend, read the identity (the password backend takes MENV_PASSPHRASE), and
// decrypt the vault into an in-memory model. We never *create* an identity here —
// a missing one means the repo isn't set up.
export async function loadModel(root: string, opts: { backend?: KeyBackend } = {}): Promise<LoadedRepo> {
  const backend = opts.backend ?? resolveBackend(await readKeyBackendConfig(root), { root, interactive: false });
  const identity = await backend.get();
  if (!identity) {
    throw new Error("menv: no identity found for this repo's key backend — run `menv init` first");
  }
  const model = await loadRepo(root, identity);
  return { model, backend, identity };
}

// Resolve the active environment: the requested one (validated) or the default.
export function defaultEnv(model: RepoModel, requested?: string): string {
  if (requested) {
    if (!model.environments.some((e) => e.id === requested)) {
      throw new Error(`menv: unknown environment "${requested}" (have: ${model.environments.map((e) => e.id).join(", ")})`);
    }
    return requested;
  }
  return model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev";
}

// Map a user-supplied scope token to a consumer id. Accepts a consumer id
// (including "root"), an app name, or — for "root" — any consumer at the repo root.
export function resolveConsumer(model: RepoModel, token: string): string {
  const byId = model.consumers.find((c) => c.id === token);
  if (byId) return byId.id;
  if (token === "root") {
    const root = model.consumers.find((c) => c.id === "root" || c.path === ".");
    if (root) return root.id;
  }
  const byName = model.consumers.filter((c) => c.name === token);
  if (byName.length === 1) return byName[0]!.id;
  if (byName.length > 1) {
    throw new Error(`menv: scope "${token}" is ambiguous by name — use a consumer id (${byName.map((c) => c.id).join(", ")})`);
  }
  throw new Error(`menv: unknown scope "${token}" (have: ${model.consumers.map((c) => c.id).join(", ")})`);
}

// Resolve a NAME to exactly one variable. `scope` (a consumer token) disambiguates
// when several variables share the name — which can happen because `init` splits a
// name into one variable per distinct value across consumers.
export function resolveVar(model: RepoModel, name: string, opts: { scope?: string } = {}): Variable {
  let cands = model.variables.filter((v) => v.name === name);
  if (opts.scope) {
    const cid = resolveConsumer(model, opts.scope);
    cands = cands.filter((v) => v.consumers.includes(cid));
  }
  if (cands.length === 0) {
    throw new Error(`menv: no variable named "${name}"${opts.scope ? ` wired to "${opts.scope}"` : ""}`);
  }
  if (cands.length > 1) {
    const variants = cands.map((v) => `${v.id} (→ ${v.consumers.join(", ") || "unwired"})`).join("; ");
    throw new Error(`menv: "${name}" is ambiguous — ${cands.length} variants: ${variants}. Disambiguate with --scope <consumer>.`);
  }
  return cands[0]!;
}

// Obtain a value to store: the positional arg if given, else stdin when piped,
// else a masked TTY prompt. Ink is lazy-loaded only for the prompt path so it
// stays out of non-interactive runs (mirroring how `init` defers its prompts).
export async function readValue(arg: string | undefined, label: string): Promise<string> {
  if (arg !== undefined) return arg;
  if (!process.stdin.isTTY) {
    return (await Bun.stdin.text()).replace(/\r?\n$/, "");
  }
  const { promptValue } = await import("../ui/initPrompts.tsx");
  return await promptValue(label);
}
