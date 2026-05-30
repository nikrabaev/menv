import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import { generateKeypair } from "../../src/crypto/age.ts";

test("generate recreates .env from the vault", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");

  const kp = await generateKeypair();
  const backend = { async get() { return kp.identity; }, async set() {} };
  await runInit(root, { backend, stamp: "s1" });

  rmSync(join(root, "apps", "api", ".env"));
  await runGenerate(root, { backend, stamp: "s2" });
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=3000");
});
