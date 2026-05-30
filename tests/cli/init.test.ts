import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { generateKeypair } from "../../src/crypto/age.ts";

test("init creates config, manifest, vault and gitignore", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");

  const kp = await generateKeypair();
  const backend = { async get() { return kp.identity; }, async set() {} };
  await runInit(root, { backend, stamp: "s1" });

  expect(await Bun.file(join(root, "menv.toml")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".menv", "manifest.toml")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".menv", "values", "dev.env.age")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".gitignore")).text()).toContain(".menv/values/");
});
