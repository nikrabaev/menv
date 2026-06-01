import { expect, test } from "bun:test";
import { varsForConsumer, valueOf } from "../../src/core/model.ts";
import type { RepoModel } from "../../src/core/types.ts";

const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "", group: "DB", secret: true, consumers: ["app:api"] },
    { id: "v2", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] },
    { id: "v3", name: "OTHER", description: "", group: null, secret: false, consumers: ["app:web"] },
  ],
  consumers: [],
  values: { v1: { dev: "pg://x" }, v2: { dev: "3000" } },
  recipients: [],
};

test("varsForConsumer returns only wired vars", () => {
  const names = varsForConsumer(model, "app:api").map((v) => v.name).sort();
  expect(names).toEqual(["DATABASE_URL", "PORT"]);
});

test("valueOf returns the env value or empty string", () => {
  expect(valueOf(model, "v1", "dev")).toBe("pg://x");
  expect(valueOf(model, "v1", "prod")).toBe("");
});
