import { expect, test } from "bun:test";
import { mkdtempSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedFiles } from "../../src/io/generate.ts";
import type { RepoModel } from "../../src/core/types.ts";

test("does not write .env.example for an app with no real env file", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "packages", "lib"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [],
    consumers: [{ kind: "app", id: "app:lib", name: "lib", path: "packages/lib", envFiles: {} }],
    values: {},
    recipients: [],
  };
  const written = await writeGeneratedFiles(model, "ts1");
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
    variables: [{ id: "v1", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: { dev: ".env" } }],
    values: { v1: { dev: "3000" } },
    recipients: [],
  };
  const written = await writeGeneratedFiles(model, "ts1");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=3000");
  expect(await Bun.file(join(root, "apps", "api", ".env.example")).text()).toContain("PORT=");
  expect(existsSync(join(root, ".menv", "backups", "ts1"))).toBe(true);
  expect(written.length).toBeGreaterThan(0);
});
