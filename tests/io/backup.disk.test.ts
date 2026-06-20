import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runGenerate } from "../../src/cli/generate.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import { backupKey, collectBackupPaths, createBackup, listBackups, restoreBackup } from "../../src/io/backup.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

describe("backupKey", () => {
  test("formats a stable sortable timestamp", () => {
    expect(backupKey(new Date(Date.UTC(2026, 5, 12, 9, 8, 7)))).toMatch(/^2026061[12]-\d{6}$/);
  });
});

describe("collect / create / restore", () => {
  async function repo() {
    const registry = makeRegistry();
    registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k" } } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k", "3000");
    await s.close();
    await runGenerate(root, registry, {}, FLAGS, { stdout() {}, stderr() {} });
    return { root, registry };
  }

  test("captures registry, vault file, and marker-bearing generated files only", async () => {
    const { root, registry } = await repo();
    await Bun.write(join(root, "apps/api/STRAY.txt"), "ignore me\n");
    const paths = await collectBackupPaths(root, registry);
    expect(paths).toContain("menv.json");
    expect(paths).toContain(".menv/vault.json");
    expect(paths).toContain("apps/api/.env");
    expect(paths).not.toContain("apps/api/STRAY.txt");
  });

  test("restore brings back overwritten files", async () => {
    const { root, registry } = await repo();
    const key = backupKey(new Date());
    await createBackup(root, key, await collectBackupPaths(root, registry));
    expect(await listBackups(root)).toContain(key);
    await Bun.write(join(root, "apps/api/.env"), "WIPED=1\n");
    const restored = await restoreBackup(root, key);
    expect(restored).toContain("apps/api/.env");
    expect(await Bun.file(join(root, "apps/api/.env")).text()).not.toBe("WIPED=1\n");
  });

  test("restore reproduces exact content, including the nested vault file", async () => {
    const { root, registry } = await repo();
    const key = backupKey(new Date());
    await createBackup(root, key, await collectBackupPaths(root, registry));
    const envBefore = await Bun.file(join(root, "apps/api/.env")).text();
    const vaultBefore = await Bun.file(join(root, ".menv/vault.json")).text();
    await Bun.write(join(root, "apps/api/.env"), "WIPED=1\n");
    await Bun.write(join(root, ".menv/vault.json"), "{}\n");
    const restored = await restoreBackup(root, key);
    expect(restored).toContain(".menv/vault.json"); // exercises the nested-directory walk
    expect(await Bun.file(join(root, "apps/api/.env")).text()).toBe(envBefore); // byte-for-byte
    expect(await Bun.file(join(root, ".menv/vault.json")).text()).toBe(vaultBefore);
  });
});
