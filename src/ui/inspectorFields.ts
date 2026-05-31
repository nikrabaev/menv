import type { RepoModel, Variable } from "../core/types.ts";

// One descriptor per navigable inspector row. The single source of truth shared by
// the Inspector (rendering) and app.tsx (keyboard actions) so the two never drift.
export type InspectorField =
  | { kind: "description" | "example" | "group"; label: string; text: string }
  | { kind: "secret"; label: string; on: boolean }
  | { kind: "wiring"; label: string; summary: string }
  | { kind: "value"; label: string; env: string; text: string; secret: boolean };

export function inspectorFields(model: RepoModel, variable: Variable): InspectorField[] {
  const consumerName = (id: string) => model.consumers.find((c) => c.id === id)?.name ?? id;
  const fields: InspectorField[] = [
    { kind: "description", label: "description", text: variable.description },
    { kind: "example", label: "example", text: variable.example ?? "" },
    { kind: "group", label: "group", text: variable.group ?? "" },
    { kind: "secret", label: "secret", on: variable.secret },
    { kind: "wiring", label: "wiring", summary: variable.consumers.map(consumerName).join(" · ") },
  ];
  for (const e of model.environments) {
    fields.push({
      kind: "value",
      label: e.id,
      env: e.id,
      text: model.values[variable.id]?.[e.id] ?? "",
      secret: variable.secret,
    });
  }
  return fields;
}

// The text `c` should copy, or null for fields that hold no copyable text.
export function copyableText(field: InspectorField): string | null {
  return field.kind === "secret" || field.kind === "wiring" ? null : field.text;
}
