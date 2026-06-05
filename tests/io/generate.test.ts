import { expect, test } from "bun:test";
import type { RepoModel } from "../../src/core/types.ts";
import { renderAppEnv, renderAppExample } from "../../src/io/generate.ts";

const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "db url", group: "DB", secret: true, wiring: [{ consumer: "app:api" }] },
    { id: "v2", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] },
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

test("renderAppEnv comments out a variable wired-but-not-applied in this env", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    variables: [
      { id: "v1", name: "FOO", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] },
      { id: "v2", name: "BAR", description: "", group: null, secret: false, wiring: [{ consumer: "app:api", unapplied: ["prod"] }] },
    ],
    consumers: [],
    values: { v1: { dev: "1", prod: "9" }, v2: { dev: "2", prod: "8" } },
    recipients: [],
  };
  // dev: both applied.
  const dev = renderAppEnv(m, "app:api", "dev");
  expect(dev).toContain("FOO=1");
  expect(dev).toContain("BAR=2");
  expect(dev).not.toContain("# BAR=");
  // prod: BAR is wired but not applied ⇒ commented, FOO stays live.
  const prod = renderAppEnv(m, "app:api", "prod");
  expect(prod).toContain("FOO=9");
  expect(prod).toContain("# BAR=8");
  expect(prod).not.toMatch(/^BAR=/m);
});

test("renderAppExample omits values", () => {
  const out = renderAppExample(model, "app:api");
  expect(out).toContain("DATABASE_URL=");
  expect(out).not.toContain("pg://x");
});

test("renderAppExample lists wired vars uncommented regardless of applied state", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "v2", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api", unapplied: ["dev"] }] },
    ],
    consumers: [],
    values: {},
    recipients: [],
  };
  const out = renderAppExample(m, "app:api");
  expect(out).toContain("PORT=");
  expect(out).not.toContain("# PORT=");
});

test("renderAppExample emits example values, empty when unset", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:REDIS_URL", name: "REDIS_URL", description: "cache", group: null, secret: false, wiring: [{ consumer: "app:api" }], example: "redis://localhost:6379" },
      { id: "var:PORT", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] },
    ],
    consumers: [],
    values: {},
    recipients: [],
  };
  const out = renderAppExample(m, "app:api");
  expect(out).toContain("REDIS_URL=redis://localhost:6379");
  expect(out).toContain("PORT=");
});
