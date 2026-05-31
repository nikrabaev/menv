import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupKey, collectEnvFiles } from "../../src/io/backup.ts";

test("backupKey formats local time as zero-padded YYYYMMDDHHmmss", () => {
  // Local-time constructor (month is 0-based): 2026-01-02 03:04:05.
  expect(backupKey(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102030405");
});

test("collectEnvFiles finds root + nested .env/.env.example, excludes junk and other variants", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, ".env"), "A=1\n");
  await Bun.write(join(root, ".env.example"), "A=\n");
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", ".env"), "B=2\n");
  await Bun.write(join(root, "apps", "api", ".env.example"), "B=\n");
  // Other dotenv variants are out of scope:
  await Bun.write(join(root, "apps", "api", ".env.local"), "X=1\n");
  await Bun.write(join(root, "apps", "api", ".env.production"), "X=1\n");
  // Excluded directories:
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await Bun.write(join(root, "node_modules", "pkg", ".env"), "N=1\n");
  await mkdir(join(root, ".menv", "backups", "old"), { recursive: true });
  await Bun.write(join(root, ".menv", "backups", "old", ".env"), "O=1\n");

  expect(await collectEnvFiles(root)).toEqual([
    ".env",
    ".env.example",
    "apps/api/.env",
    "apps/api/.env.example",
  ]);
});

test("collectEnvFiles returns [] for a repo with no env files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  expect(await collectEnvFiles(root)).toEqual([]);
});
