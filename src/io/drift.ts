import { join } from "node:path";
import { isApplied, resolveValue, varsForConsumer } from "../core/model.ts";
import type { RepoModel, Variable } from "../core/types.ts";
import { parseDotenv } from "./dotenv.ts";

// One generated file menv would write, paired with the variable slice that feeds
// it. Mirrors the app env-file selection logic in `writeGeneratedFiles` — sans
// `.env.example` (placeholder text, not real values), and sans the docker-compose
// files / `.env.compose` it also writes (those are rewritten in full each save and
// are not drift-checked). Used to know which on-disk files to compare against the vault.
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
  // Keys present on disk but unknown to the vault (a hand-added line). `active`
  // records whether it was a live `KEY=value` or a commented-out `# KEY=value`.
  added: { name: string; value: string; description: string; active: boolean }[];
  // Keys whose live on-disk value differs from the vault.
  changed: { name: string; varId: string; expected: string; actual: string }[];
  // Keys whose applied state diverged: a wired var deleted/commented on disk
  // (`to: false`) or uncommented (`to: true`). Deleting a line unapplies the
  // variable (it returns commented) rather than removing it — removal is `unwire`.
  applied: { name: string; varId: string; to: boolean }[];
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

    const onDisk = new Map<string, { value: string; description: string; active: boolean }>();
    for (const e of parseDotenv(await file.text())) onDisk.set(e.key, { value: e.value, description: e.description, active: e.active });

    const expected = new Map<string, { varId: string; value: string; applied: boolean }>();
    for (const v of t.vars) {
      expected.set(v.name, { varId: v.id, value: resolveValue(model, v.id, t.env), applied: isApplied(v, t.consumerId, t.env) });
    }

    const added: FileDrift["added"] = [];
    const changed: FileDrift["changed"] = [];
    const applied: FileDrift["applied"] = [];
    for (const [name, d] of onDisk) {
      const exp = expected.get(name);
      if (!exp) {
        added.push({ name, value: d.value, description: d.description, active: d.active });
        continue;
      }
      // Applied-state divergence (live ↔ commented) is independent of a value edit.
      if (d.active !== exp.applied) applied.push({ name, varId: exp.varId, to: d.active });
      // Only a live line carries an authoritative value worth importing.
      if (d.active && d.value !== exp.value) changed.push({ name, varId: exp.varId, expected: exp.value, actual: d.value });
    }
    for (const [name, exp] of expected) {
      // A key the vault applies but the file no longer has was deleted by hand:
      // treat as "unapply" (it returns commented), not removal.
      if (!onDisk.has(name) && exp.applied) applied.push({ name, varId: exp.varId, to: false });
    }

    if (added.length || changed.length || applied.length)
      drifts.push({ rel: t.rel, consumerId: t.consumerId, env: t.env, local: t.local, added, changed, applied });
  }
  return drifts;
}
