import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { loadRegistry } from "../../src/registry/persist.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-init-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("runInit", () => {
  test("creates an empty encrypted-vault registry and the gitignore block", async () => {
    await runInit(root, { encrypt: true });
    const r = await loadRegistry(root);
    expect(r.schemaVersion).toBe(2);
    expect(r.defaults.vault).toBe("local");
    expect(r.vaults.local).toEqual({
      vaultType: "menv-local",
      vaultConfig: { filename: ".menv/vault.json", encryption: true },
    });
    expect(r.consumers).toEqual({});
    expect(r.variables).toEqual({});
    const gi = await Bun.file(join(root, ".gitignore")).text();
    expect(gi).toContain(".menv/auth.local.json");
    expect(gi).toContain(".menv/backups/");
    expect(gi).not.toContain(".menv/vault.json"); // encrypted ⇒ committable
  });

  test("--no-encrypt git-ignores the plaintext vault file", async () => {
    await runInit(root, { encrypt: false });
    const r = await loadRegistry(root);
    expect(r.vaults.local?.vaultConfig).toEqual({ filename: ".menv/vault.json", encryption: false });
    expect(await Bun.file(join(root, ".gitignore")).text()).toContain(".menv/vault.json");
  });

  test("refuses an already-initialized repo and a v1 repo", async () => {
    await runInit(root, { encrypt: true });
    try {
      await runInit(root, { encrypt: true });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).message).toContain("already initialized");
    }
    const v1 = await mkdtemp(join(tmpdir(), "menv-init-v1-"));
    try {
      await Bun.write(join(v1, "menv.toml"), "");
      try {
        await runInit(v1, { encrypt: true });
        expect.unreachable();
      } catch (e) {
        expect((e as MenvError).message).toContain("v1");
      }
    } finally {
      await rm(v1, { recursive: true, force: true });
    }
  });
});
