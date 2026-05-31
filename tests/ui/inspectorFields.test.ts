import { expect, test } from "bun:test";
import { inspectorFields, copyableText } from "../../src/ui/inspectorFields.ts";
import type { RepoModel, Variable } from "../../src/core/types.ts";

const variable: Variable = {
  id: "v1", name: "DATABASE_URL", tier: "global",
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

test("inspectorFields lists fixed fields then one value row per environment", () => {
  const fields = inspectorFields(model, variable);
  expect(fields.map((f) => f.kind)).toEqual([
    "description", "example", "group", "secret", "wiring", "value", "value",
  ]);
  const dev = fields.find((f) => f.kind === "value" && f.label === "dev");
  expect(dev).toMatchObject({ kind: "value", env: "dev", text: "pg://dev", secret: true });
});

test("wiring summary uses consumer display names", () => {
  const wiring = inspectorFields(model, variable).find((f) => f.kind === "wiring")!;
  expect(wiring).toMatchObject({ summary: "api" });
});

test("copyableText returns text for text fields and null for secret/wiring", () => {
  const fields = inspectorFields(model, variable);
  expect(copyableText(fields[0]!)).toBe("db conn"); // description
  expect(copyableText(fields.find((f) => f.kind === "secret")!)).toBeNull();
  expect(copyableText(fields.find((f) => f.kind === "wiring")!)).toBeNull();
  expect(copyableText(fields.find((f) => f.kind === "value" && f.label === "prod")!)).toBe("pg://prod");
});
