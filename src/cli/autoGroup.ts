import { autoGroupAssignments } from "../core/autogroup.ts";
import type { KeyBackend } from "../crypto/identity.ts";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { defaultEnv, loadModel } from "./context.ts";

export interface AutoGroupOpts {
  backend?: KeyBackend;
  overwrite?: boolean; // re-derive groups for every variable, replacing existing ones
  stamp?: string;
}

export interface AutoGroupResult {
  grouped: number; // how many variables had their group changed
  groups: string[]; // the distinct group names assigned (sorted)
}

// Assign variables to groups by their shared name prefix (the text before the
// first underscore); a prefix becomes a group only when 2+ distinct variable
// names share it. By default only ungrouped variables are touched; `overwrite`
// re-derives groups for all of them. A run that changes nothing leaves the vault
// and generated files untouched (no needless rewrite/backup).
export async function runAutoGroup(root: string, opts: AutoGroupOpts = {}): Promise<AutoGroupResult> {
  const { model } = await loadModel(root, { backend: opts.backend });
  const assignments = autoGroupAssignments(model.variables, { overwrite: opts.overwrite });

  if (assignments.length) {
    const store = createStore(model);
    for (const a of assignments) store.setGroup(a.id, a.group);
    await saveModel(store.getModel(), defaultEnv(model), opts.stamp ?? "auto-group");
  }

  return {
    grouped: assignments.length,
    groups: [...new Set(assignments.map((a) => a.group))].sort(),
  };
}
