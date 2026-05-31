import { expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup, listBackups, backupExists, backupFiles, restoreBackup } from "../../src/io/backup.ts";

async function setupRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, ".env"), "ROOT=1\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "api", ".env.example"), "PORT=\n");
  return root;
}

test("createBackup preserves the relative layout under .menv/backups/<key>", async () => {
  const root = await setupRepo();
  const files = await createBackup(root, "k1");
  expect(files).toEqual([".env", "apps/api/.env", "apps/api/.env.example"]);
  expect(existsSync(join(root, ".menv", "backups", "k1", ".env"))).toBe(true);
  expect(await Bun.file(join(root, ".menv", "backups", "k1", "apps", "api", ".env")).text()).toBe("PORT=3000\n");
});

test("createBackup makes the key dir even when there are no env files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  expect(await createBackup(root, "empty")).toEqual([]);
  expect(existsSync(join(root, ".menv", "backups", "empty"))).toBe(true);
});

test("listBackups returns dirs newest-first and [] when absent", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  expect(await listBackups(root)).toEqual([]);
  await createBackup(root, "20260101000000");
  await createBackup(root, "20260102000000");
  expect(await listBackups(root)).toEqual(["20260102000000", "20260101000000"]);
});

test("backupExists reflects presence", async () => {
  const root = await setupRepo();
  await createBackup(root, "k1");
  expect(await backupExists(root, "k1")).toBe(true);
  expect(await backupExists(root, "nope")).toBe(false);
});

test("backupFiles recurses into nested dirs", async () => {
  const root = await setupRepo();
  await createBackup(root, "k1");
  expect(await backupFiles(root, "k1")).toEqual([".env", "apps/api/.env", "apps/api/.env.example"]);
});

test("restoreBackup honors decide, restores non-existing files, and recreates a deleted parent dir", async () => {
  const root = await setupRepo();
  await createBackup(root, "k1");
  // Mutate the root file, then delete the whole app dir.
  await Bun.write(join(root, ".env"), "ROOT=changed\n");
  rmSync(join(root, "apps", "api"), { recursive: true, force: true });

  // Keep the changed root file; everything else (now missing) restores regardless.
  const result = await restoreBackup(root, "k1", (rel) => rel !== ".env");

  expect(await Bun.file(join(root, ".env")).text()).toBe("ROOT=changed\n");
  expect(result.skipped).toEqual([".env"]);
  expect(existsSync(join(root, "apps", "api", ".env"))).toBe(true);
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toBe("PORT=3000\n");
  expect(result.restored).toEqual(["apps/api/.env", "apps/api/.env.example"]);
});
