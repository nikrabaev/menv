import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import { generateKeypair } from "../../src/crypto/age.ts";
import type { PassphraseProvider } from "../../src/crypto/identity.ts";

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

test("generate writes per-env files for a consumer that had .env.<env> files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  // The presence of a `.env.production` file flips the consumer to per-env mode:
  // `.env` seeds "dev", `.env.production` seeds "production".
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "api", ".env.production"), "PORT=8080\n");

  const kp = await generateKeypair();
  const backend = { async get() { return kp.identity; }, async set() {} };
  await runInit(root, { backend, stamp: "s1" });

  // Per-env mode writes one file per environment, side by side, regardless of --env.
  await runGenerate(root, { backend, stamp: "s2" });
  expect(await Bun.file(join(root, "apps", "api", ".env.dev")).text()).toContain("PORT=3000");
  expect(await Bun.file(join(root, "apps", "api", ".env.production")).text()).toContain("PORT=8080");
});

test("generate with the password backend reads MENV_PASSPHRASE", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");

  const pass: PassphraseProvider = { async unlock() { return "pw"; }, async create() { return "pw"; } };
  await runInit(root, { kind: "password", pass, stamp: "s1" });
  rmSync(join(root, "apps", "api", ".env"));

  const prev = Bun.env.MENV_PASSPHRASE;
  Bun.env.MENV_PASSPHRASE = "pw";
  try {
    // No backend passed: resolved from menv.toml (password) with the env passphrase.
    await runGenerate(root, { stamp: "s2" });
    expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("PORT=3000");

    Bun.env.MENV_PASSPHRASE = "";
    expect(runGenerate(root, { stamp: "s3" })).rejects.toThrow(/MENV_PASSPHRASE/);
  } finally {
    if (prev === undefined) delete Bun.env.MENV_PASSPHRASE;
    else Bun.env.MENV_PASSPHRASE = prev;
  }
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
