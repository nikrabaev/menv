import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoModel } from "../../src/core/types.ts";
import { generateKeypair } from "../../src/crypto/age.ts";
import { loadEnvValues } from "../../src/crypto/vault.ts";
import { readModelFiles } from "../../src/io/persist.ts";
import { loadRepo } from "../../src/store/load.ts";
import { saveModel } from "../../src/store/save.ts";

test("save writes config, manifest, encrypted vault, and .env files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const { identity, recipient } = await generateKeypair();
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: { v1: { dev: "3000" } },
    recipients: [recipient],
  };
  const summary = await saveModel(model, "dev", "stamp1");
  expect(summary.files.some((f) => f.endsWith(".env"))).toBe(true);

  const parts = await readModelFiles(root);
  expect(parts.variables[0].name).toBe("PORT");
  const vals = await loadEnvValues(root, "dev", identity);
  expect(vals.v1).toBe("3000");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=3000");
});

test("save+load keep two same-named per-app locals with different values", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await mkdir(join(root, "apps", "web"), { recursive: true });
  const { identity, recipient } = await generateKeypair();
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:app:api:NODE_ENV", name: "NODE_ENV", description: "", group: null, secret: false, consumers: ["app:api"] },
      { id: "var:app:web:NODE_ENV", name: "NODE_ENV", description: "", group: null, secret: false, consumers: ["app:web"] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" },
      { kind: "app", id: "app:web", name: "web", path: "apps/web", envFile: ".env" },
    ],
    values: { "var:app:api:NODE_ENV": { dev: "development" }, "var:app:web:NODE_ENV": { dev: "production" } },
    recipients: [recipient],
  };
  await saveModel(model, "dev", "s1");
  const loaded = await loadRepo(root, identity);
  expect(loaded.values["var:app:api:NODE_ENV"].dev).toBe("development");
  expect(loaded.values["var:app:web:NODE_ENV"].dev).toBe("production");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("NODE_ENV=development");
  expect(await Bun.file(join(root, "apps", "web", ".env")).text()).toContain("NODE_ENV=production");
});
