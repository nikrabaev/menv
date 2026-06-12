import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackup } from "../../src/cli/backup.ts";

test("runBackup returns the relative backup path and the copied file list", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  // apps/api must be a workspace package: backup only collects from init's scan
  // targets (repo root + workspace dirs).
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "repo", workspaces: ["apps/*"] }));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "api", ".env.example"), "PORT=\n");

  const out = await runBackup(root, { key: "20260112223049" });
  expect(out.key).toBe("20260112223049");
  expect(out.rel).toBe(".menv/backups/20260112223049");
  expect(out.files).toEqual(["apps/api/.env", "apps/api/.env.example"]);
});
