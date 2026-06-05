import { consumerIdsOf, isApplied } from "../core/model.ts";
import type { RepoModel, Variable } from "../core/types.ts";

// One descriptor per navigable inspector row. The single source of truth shared by
// the Inspector (rendering) and app.tsx (keyboard actions) so the two never drift.
export type InspectorField =
  | { kind: "description" | "example" | "group"; label: string; text: string }
  | { kind: "secret"; label: string; on: boolean }
  | { kind: "wiring"; label: string; summary: string }
  | { kind: "value"; label: string; env: string; text: string; secret: boolean };

// `env` is the environment currently selected in the app: the inspector shows the
// value for that one environment only (switch environments to see the others).
export function inspectorFields(model: RepoModel, variable: Variable, env: string): InspectorField[] {
  const consumerName = (id: string) => model.consumers.find((c) => c.id === id)?.name ?? id;
  return [
    { kind: "description", label: "Description", text: variable.description },
    { kind: "example", label: "Example", text: variable.example ?? "" },
    { kind: "group", label: "Group", text: variable.group ?? "" },
    { kind: "secret", label: "Secret", on: variable.secret },
    {
      kind: "wiring", label: "Wiring",
      // A consumer the variable is wired to but not applied in for the shown env is
      // tagged "(off)" — it is generated commented-out there.
      summary: consumerIdsOf(variable)
        .map((id) => (isApplied(variable, id, env) ? consumerName(id) : `${consumerName(id)} (off)`))
        .join(" · "),
    },
    {
      kind: "value",
      label: "Value",
      env,
      text: model.values[variable.id]?.[env] ?? "",
      secret: variable.secret,
    },
  ];
}

// The text `c` should copy, or null for fields that hold no copyable text.
export function copyableText(field: InspectorField): string | null {
  return field.kind === "secret" || field.kind === "wiring" ? null : field.text;
}
