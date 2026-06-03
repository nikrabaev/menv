import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoModel } from "../../src/core/types.ts";
import { writeGeneratedFiles } from "../../src/io/generate.ts";

test("does not write .env.example for an app with no real env file", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "packages", "lib"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [],
    consumers: [{ kind: "app", id: "app:lib", name: "lib", path: "packages/lib" }],
    values: {},
    recipients: [],
  };
  const written = await writeGeneratedFiles(model, "dev", "ts1");
  expect(written).toEqual([]);
  expect(existsSync(join(root, "packages", "lib", ".env.example"))).toBe(false);
});

test("writes .env + .env.example and backs up overwritten files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", ".env"), "OLD=1\n");
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: { v1: { dev: "3000" } },
    recipients: [],
  };
  const written = await writeGeneratedFiles(model, "dev", "ts1");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=3000");
  expect(await Bun.file(join(root, "apps", "api", ".env.example")).text()).toContain("PORT=");
  expect(existsSync(join(root, ".menv", "backups", "ts1"))).toBe(true);
  expect(written.length).toBeGreaterThan(0);
});

test("materializes a repo-root .env for variables wired to the root target", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "SHARED", description: "", group: null, secret: false, consumers: ["root"] }],
    consumers: [{ kind: "app", id: "root", name: "root", path: ".", envFile: ".env" }],
    values: { v1: { dev: "rootval" } },
    recipients: [],
  };
  await writeGeneratedFiles(model, "dev", "ts1");
  expect(await Bun.file(join(root, ".env")).text()).toContain("SHARED=rootval");
});

test("skips a consumer with no wired variables (no stray empty file)", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [],
    // root has envFile set but nothing is wired to it.
    consumers: [{ kind: "app", id: "root", name: "root", path: ".", envFile: ".env" }],
    values: {},
    recipients: [],
  };
  const written = await writeGeneratedFiles(model, "dev", "ts1");
  expect(written).toEqual([]);
  expect(existsSync(join(root, ".env"))).toBe(false);
});

test("perenv mode writes one .env.<env> per environment (ignoring the active env)", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env", envMode: "perenv" }],
    values: { v1: { dev: "3000", prod: "8080" } },
    recipients: [],
  };
  // Active env is "dev", but per-env mode writes every environment's file.
  await writeGeneratedFiles(model, "dev", "ts1");
  expect(await Bun.file(join(root, "apps", "api", ".env.dev")).text()).toContain("PORT=3000");
  expect(await Bun.file(join(root, "apps", "api", ".env.prod")).text()).toContain("PORT=8080");
  expect(await Bun.file(join(root, "apps", "api", ".env.example")).text()).toContain("PORT=");
  // The single canonical .env is not written in per-env mode.
  expect(existsSync(join(root, "apps", "api", ".env"))).toBe(false);
});

test("perenv mode skips an environment the consumer has no values in", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const model: RepoModel = {
    root,
    // "dev" is a global environment (some other app uses it) that api has no data in.
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env", envMode: "perenv" }],
    values: { v1: { prod: "8080" } }, // only prod has a value
    recipients: [],
  };
  await writeGeneratedFiles(model, "dev", "ts1");
  expect(await Bun.file(join(root, "apps", "api", ".env.prod")).text()).toContain("PORT=8080");
  // No stray empty .env.dev for an environment api doesn't participate in.
  expect(existsSync(join(root, "apps", "api", ".env.dev"))).toBe(false);
});

test("single mode writes .env (base) and .env.local (override) side by side", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "web"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:web"] },
      { id: "var:PORT.local", name: "PORT", description: "", group: null, secret: false, consumers: ["app:web"], local: true },
    ],
    consumers: [{ kind: "app", id: "app:web", name: "web", path: "apps/web", envFile: ".env" }],
    values: { "var:PORT": { dev: "3000" }, "var:PORT.local": { dev: "3001" } },
    recipients: [],
  };
  await writeGeneratedFiles(model, "dev", "ts1");
  expect(await Bun.file(join(root, "apps", "web", ".env")).text()).toContain("PORT=3000");
  expect(await Bun.file(join(root, "apps", "web", ".env.local")).text()).toContain("PORT=3001");
  // The override never bleeds into the shared example template.
  expect(await Bun.file(join(root, "apps", "web", ".env.example")).text()).not.toContain("3001");
});

test("perenv mode writes .env.<env>.local for an override", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "production", isDefault: false }],
    variables: [
      { id: "var:API_URL", name: "API_URL", description: "", group: null, secret: false, consumers: ["app:api"] },
      { id: "var:API_URL.local", name: "API_URL", description: "", group: null, secret: false, consumers: ["app:api"], local: true },
    ],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env", envMode: "perenv" }],
    values: { "var:API_URL": { production: "https://prod" }, "var:API_URL.local": { production: "https://override" } },
    recipients: [],
  };
  await writeGeneratedFiles(model, "production", "ts1");
  expect(await Bun.file(join(root, "apps", "api", ".env.production")).text()).toContain("API_URL=https://prod");
  expect(await Bun.file(join(root, "apps", "api", ".env.production.local")).text()).toContain("API_URL=https://override");
});

test("a consumer with only base vars writes no stray .env.local", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: { "var:PORT": { dev: "3000" } },
    recipients: [],
  };
  await writeGeneratedFiles(model, "dev", "ts1");
  expect(existsSync(join(root, "apps", "api", ".env.local"))).toBe(false);
});

test("writes only .env for the active env across multiple environments", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: { v1: { dev: "3000", prod: "8080" } },
    recipients: [],
  };
  await writeGeneratedFiles(model, "prod", "ts1");
  // The active env's value lands in .env, and no per-environment file is created.
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=8080");
  expect(existsSync(join(root, "apps", "api", ".env.production"))).toBe(false);
  expect(existsSync(join(root, "apps", "api", ".env.prod"))).toBe(false);
});
