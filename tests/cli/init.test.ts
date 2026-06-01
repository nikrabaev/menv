import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { generateKeypair } from "../../src/crypto/age.ts";
import { onePasswordBackend, type PassphraseProvider } from "../../src/crypto/identity.ts";

async function scaffold(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");
  return root;
}

test("init creates config, manifest, vault and gitignore", async () => {
  const root = await scaffold();

  const kp = await generateKeypair();
  const backend = { async get() { return kp.identity; }, async set() { return { kind: "keychain" as const }; } };
  await runInit(root, { backend, stamp: "s1" });

  expect(await Bun.file(join(root, "menv.toml")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".menv", "manifest.toml")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".menv", "values", "development.env.age")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".gitignore")).text()).toContain(".menv/values/");
});

test("init --backend password writes a committed identity blob and records the kind", async () => {
  const root = await scaffold();
  const pass: PassphraseProvider = { async unlock() { return "pw"; }, async create() { return "pw"; } };
  await runInit(root, { kind: "password", pass, stamp: "s1" });

  expect(await Bun.file(join(root, ".menv", "identity.age")).exists()).toBe(true);
  const gitignore = await Bun.file(join(root, ".gitignore")).text();
  expect(gitignore).not.toContain("identity.age"); // committed, not ignored
  expect(await Bun.file(join(root, "menv.toml")).text()).toContain('kind = "password"');
});

test("init --backend 1password persists the op:// reference", async () => {
  const root = await scaffold();
  const exec = async (args: string[]) =>
    args[1] === "create"
      ? { code: 0, stdout: JSON.stringify({ id: "itm" }), stderr: "" }
      : { code: 1, stdout: "", stderr: "unexpected" };
  const backend = onePasswordBackend({ vault: "Dev", exec });
  await runInit(root, { backend, stamp: "s1" });

  const toml = await Bun.file(join(root, "menv.toml")).text();
  expect(toml).toContain('kind = "1password"');
  expect(toml).toContain("op://Dev/itm/password");
});
