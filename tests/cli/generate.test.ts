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

test("generate --env writes the chosen environment's values into .env", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  // Two real env files seed a "dev" and a "production" environment in the vault.
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "api", ".env.production"), "PORT=8080\n");

  const kp = await generateKeypair();
  const backend = { async get() { return kp.identity; }, async set() {} };
  await runInit(root, { backend, stamp: "s1" });

  // No --env uses the default (dev); --env production switches the .env contents.
  await runGenerate(root, { backend, stamp: "s2" });
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=3000");
  await runGenerate(root, { backend, env: "production", stamp: "s3" });
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=8080");
});

test("generate rejects an unknown --env", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");

  const kp = await generateKeypair();
  const backend = { async get() { return kp.identity; }, async set() {} };
  await runInit(root, { backend, stamp: "s1" });

  expect(runGenerate(root, { backend, env: "nope", stamp: "s2" })).rejects.toThrow(/unknown environment/);
});
