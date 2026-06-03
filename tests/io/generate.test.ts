import { expect, test } from "bun:test";
import type { RepoModel } from "../../src/core/types.ts";
import { renderAppEnv, renderAppExample } from "../../src/io/generate.ts";

const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "db url", group: "DB", secret: true, consumers: ["app:api"] },
    { id: "v2", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] },
  ],
  consumers: [],
  values: { v1: { dev: "pg://x" }, v2: { dev: "3000" } },
  recipients: [],
};

test("renderAppEnv emits grouped values with descriptions", () => {
  const out = renderAppEnv(model, "app:api", "dev");
  expect(out).toContain("# ─── DB ───");
  expect(out).toContain("# db url");
  expect(out).toContain("DATABASE_URL=pg://x");
  expect(out).toContain("PORT=3000");
});

test("renderAppExample omits values", () => {
  const out = renderAppExample(model, "app:api");
  expect(out).toContain("DATABASE_URL=");
  expect(out).not.toContain("pg://x");
});

test("renderAppExample emits example values, empty when unset", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:REDIS_URL", name: "REDIS_URL", description: "cache", group: null, secret: false, consumers: ["app:api"], example: "redis://localhost:6379" },
      { id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] },
    ],
    consumers: [],
    values: {},
    recipients: [],
  };
  const out = renderAppExample(m, "app:api");
  expect(out).toContain("REDIS_URL=redis://localhost:6379");
  expect(out).toContain("PORT=");
});
