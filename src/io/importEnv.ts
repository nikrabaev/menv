import { freeVarId } from "../core/model.ts";
import type { Store } from "../store/store.ts";
import { isSecretName } from "./discovery.ts";
import type { FileDrift } from "./drift.ts";

// Pull a drifted file's hand-edits back into the vault:
//   • changed value → update the existing variable for the file's environment;
//   • added (unknown) key → mint a new variable wired to that consumer, carrying
//     the file's base/local flag and the same secret-name heuristic init uses;
//   • removed key → left untouched (report-only): dropping a variable is an
//     explicit TUI action, never an implicit consequence of a hand-edit.
export function applyFileDrift(store: Store, drift: FileDrift): void {
  for (const ch of drift.changed) store.setValue(ch.varId, drift.env, ch.actual);

  if (drift.added.length === 0) return;
  const usedIds = new Set(store.getModel().variables.map((v) => v.id));
  for (const a of drift.added) {
    const id = freeVarId(usedIds, a.name, { local: drift.local });
    usedIds.add(id);
    store.addVariable({
      id, name: a.name, description: a.description, group: null,
      secret: isSecretName(a.name), consumers: [drift.consumerId],
      ...(drift.local ? { local: true } : {}),
    });
    store.setValue(id, drift.env, a.value);
  }
}
