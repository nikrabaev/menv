import { expect, test } from "bun:test";
import { renderAppEnv, renderAppExample } from "../../src/io/generate.ts";
import type { RepoModel } from "../../src/core/types.ts";

const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", tier: "global", description: "db url", group: "DB", secret: true, consumers: ["app:api"] },
    { id: "v2", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
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
