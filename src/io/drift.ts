import { join } from "node:path";
import { resolveValue, varsForConsumer } from "../core/model.ts";
import type { RepoModel, Variable } from "../core/types.ts";
import { parseDotenv } from "./dotenv.ts";

// One generated file menv would write, paired with the variable slice that feeds
// it. Mirrors the selection logic in `writeGeneratedFiles` (sans `.env.example`,
// which holds placeholder text rather than real values and so is never drift-
// checked). Used to know which on-disk files to compare against the vault.
interface GenTarget {
  rel: string;
  consumerId: string;
  env: string;
  local: boolean;
  vars: Variable[];
}

function genTargets(model: RepoModel, env: string): GenTarget[] {
  const targets: GenTarget[] = [];
  for (const c of model.consumers) {
    if (c.kind !== "app" || !c.envFile) continue;
    const vars = varsForConsumer(model, c.id);
    if (vars.length === 0) continue;
    const baseVars = vars.filter((v) => !(v.local ?? false));
    const localVars = vars.filter((v) => v.local ?? false);
    const hasValIn = (list: Variable[], e: string) =>
      list.some((v) => model.values[v.id]?.[e] !== undefined);
    if (c.envMode === "perenv") {
      for (const e of model.environments) {
        if (baseVars.length && hasValIn(baseVars, e.id))
          targets.push({ rel: join(c.path, `.env.${e.id}`), consumerId: c.id, env: e.id, local: false, vars: baseVars });
        if (localVars.length && hasValIn(localVars, e.id))
          targets.push({ rel: join(c.path, `.env.${e.id}.local`), consumerId: c.id, env: e.id, local: true, vars: localVars });
      }
    } else {
      if (baseVars.length)
        targets.push({ rel: join(c.path, c.envFile), consumerId: c.id, env, local: false, vars: baseVars });
      if (localVars.length && hasValIn(localVars, env))
        targets.push({ rel: join(c.path, `${c.envFile}.local`), consumerId: c.id, env, local: true, vars: localVars });
    }
  }
  return targets;
}

export interface FileDrift {
  rel: string;
  consumerId: string;
  env: string;
  local: boolean;
  // Keys present on disk but unknown to the vault (a hand-added line).
  added: { name: string; value: string; description: string }[];
  // Keys whose on-disk value differs from the vault.
  changed: { name: string; varId: string; expected: string; actual: string }[];
  // Keys the vault expects but the file no longer has (a hand-deleted line).
  removed: { name: string; varId: string }[];
}

// Compares every generated file that exists on disk against the value the vault
// would emit for it, reporting per-file additions, changes and removals. Files
// that don't exist (never generated) are not drift. Single-mode `.env` is
// compared against `env` — the caller passes the default environment, since we
// can't know which environment was last materialized into a single `.env`.
export async function detectDrift(model: RepoModel, env: string): Promise<FileDrift[]> {
  const drifts: FileDrift[] = [];
  for (const t of genTargets(model, env)) {
    const file = Bun.file(join(model.root, t.rel));
    if (!(await file.exists())) continue;

    const onDisk = new Map<string, { value: string; description: string }>();
    for (const e of parseDotenv(await file.text())) onDisk.set(e.key, { value: e.value, description: e.description });

    const expected = new Map<string, { varId: string; value: string }>();
    for (const v of t.vars) expected.set(v.name, { varId: v.id, value: resolveValue(model, v.id, t.env) });

    const added: FileDrift["added"] = [];
    const changed: FileDrift["changed"] = [];
    const removed: FileDrift["removed"] = [];
    for (const [name, d] of onDisk) {
      const exp = expected.get(name);
      if (!exp) added.push({ name, value: d.value, description: d.description });
      else if (exp.value !== d.value) changed.push({ name, varId: exp.varId, expected: exp.value, actual: d.value });
    }
    for (const [name, exp] of expected) {
      if (!onDisk.has(name)) removed.push({ name, varId: exp.varId });
    }

    if (added.length || changed.length || removed.length)
      drifts.push({ rel: t.rel, consumerId: t.consumerId, env: t.env, local: t.local, added, changed, removed });
  }
  return drifts;
}
