import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveModel } from "../../src/store/save.ts";
import { readModelFiles } from "../../src/io/persist.ts";
import { loadEnvValues } from "../../src/crypto/vault.ts";
import { generateKeypair } from "../../src/crypto/age.ts";
import type { RepoModel } from "../../src/core/types.ts";

test("save writes config, manifest, encrypted vault, and .env files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const { identity, recipient } = await generateKeypair();
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: { dev: ".env" } }],
    values: { v1: { dev: "3000" } },
    recipients: [recipient],
  };
  const summary = await saveModel(model, "stamp1");
  expect(summary.files.some((f) => f.endsWith(".env"))).toBe(true);

  const parts = await readModelFiles(root);
  expect(parts.variables[0].name).toBe("PORT");
  const vals = await loadEnvValues(root, "dev", identity);
  expect(vals.PORT).toBe("3000");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=3000");
});
