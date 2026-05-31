import type { RepoModel, Variable } from "../core/types.ts";
import type { Store } from "../store/store.ts";

// Which text field an open EditFieldModal is editing. Toggles (secret) and wiring
// don't use the modal, so they aren't represented here.
export type EditTarget =
  | { kind: "value"; env: string }
  | { kind: "description" }
  | { kind: "example" }
  | { kind: "group" };

export function editLabel(t: EditTarget): string {
  return t.kind === "value" ? `value · ${t.env}` : t.kind;
}

export function editInitial(model: RepoModel, v: Variable, t: EditTarget): string {
  switch (t.kind) {
    case "value": return model.values[v.id]?.[t.env] ?? "";
    case "description": return v.description;
    case "example": return v.example ?? "";
    case "group": return v.group ?? "";
  }
}

export function applyEdit(store: Store, varId: string, t: EditTarget, value: string): void {
  switch (t.kind) {
    case "value": store.setValue(varId, t.env, value); return;
    case "description": store.setDescription(varId, value); return;
    case "example": store.setExample(varId, value); return;
    case "group": store.setGroup(varId, value.trim() || null); return;
  }
}
