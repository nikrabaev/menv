import { expect, test } from "bun:test";
import type { RepoModel, Variable } from "../../src/core/types.ts";
import { copyableText, inspectorFields } from "../../src/ui/inspectorFields.ts";

const variable: Variable = {
  id: "v1", name: "DATABASE_URL",
  description: "db conn", group: "DB", secret: true,
  consumers: ["app:api"], example: "pg://example",
};
const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
  variables: [variable],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api" }],
  values: { v1: { dev: "pg://dev", prod: "pg://prod" } },
  recipients: [],
};

test("inspectorFields lists fixed fields then a single value row for the current env", () => {
  const fields = inspectorFields(model, variable, "prod");
  expect(fields.map((f) => f.kind)).toEqual([
    "description", "example", "group", "secret", "wiring", "value",
  ]);
  const value = fields.find((f) => f.kind === "value");
  expect(value).toMatchObject({ kind: "value", label: "Value", env: "prod", text: "pg://prod", secret: true });
});

test("the value row follows the requested environment", () => {
  const value = inspectorFields(model, variable, "dev").find((f) => f.kind === "value");
  expect(value).toMatchObject({ env: "dev", text: "pg://dev" });
});

test("wiring summary uses consumer display names", () => {
  const wiring = inspectorFields(model, variable, "dev").find((f) => f.kind === "wiring")!;
  expect(wiring).toMatchObject({ summary: "api" });
});

test("copyableText returns text for text fields and null for secret/wiring", () => {
  const fields = inspectorFields(model, variable, "prod");
  expect(copyableText(fields[0]!)).toBe("db conn"); // description
  expect(copyableText(fields.find((f) => f.kind === "secret")!)).toBeNull();
  expect(copyableText(fields.find((f) => f.kind === "wiring")!)).toBeNull();
  expect(copyableText(fields.find((f) => f.kind === "value")!)).toBe("pg://prod");
});
