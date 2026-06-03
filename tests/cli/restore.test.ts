import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RestorePrompts, runRestore } from "../../src/cli/restore.ts";
import { createBackup } from "../../src/io/backup.ts";

// Prompts that fail loudly: used when a code path must not prompt at all.
const noPrompts: RestorePrompts = {
  async selectBackup() { throw new Error("should not prompt for a backup"); },
  async resolveConflicts() { throw new Error("should not prompt for conflicts"); },
};

async function repoWithBackup(key: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "api", ".env.example"), "PORT=\n");
  await createBackup(root, key);
  return root;
}

test("an unknown key returns not-found with the available list", async () => {
  const root = await repoWithBackup("k1");
  const r = await runRestore(root, { key: "nope" }, noPrompts);
  expect(r.kind).toBe("not-found");
  expect(r.available).toEqual(["k1"]);
});

test("no backups returns no-backups", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const r = await runRestore(root, {}, noPrompts);
  expect(r.kind).toBe("no-backups");
});

test("force overwrites all conflicting files without prompting", async () => {
  const root = await repoWithBackup("k1");
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=changed\n");
  const r = await runRestore(root, { key: "k1", force: true }, noPrompts);
  expect(r.kind).toBe("done");
  expect(r.restored).toContain("apps/api/.env");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toBe("PORT=3000\n");
});

test("per-file answers map to restored/skipped; non-existing files always restore", async () => {
  const root = await repoWithBackup("k1");
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=changed\n");
  rmSync(join(root, "apps", "api", ".env.example")); // now a brand-new restore
  const prompts: RestorePrompts = {
    async selectBackup() { throw new Error("should not select"); },
    async resolveConflicts(conflicts) {
      expect(conflicts).toEqual(["apps/api/.env"]); // only the existing file
      return { "apps/api/.env": false };
    },
  };
  const r = await runRestore(root, { key: "k1" }, prompts);
  expect(r.kind).toBe("done");
  expect(r.skipped).toEqual(["apps/api/.env"]);
  expect(r.restored).toEqual(["apps/api/.env.example"]);
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toBe("PORT=changed\n");
});

test("selectBackup chooses the key when none is given", async () => {
  const root = await repoWithBackup("k1");
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=changed\n");
  const prompts: RestorePrompts = {
    async selectBackup(keys) { expect(keys).toEqual(["k1"]); return "k1"; },
    async resolveConflicts() { return { "apps/api/.env": true, "apps/api/.env.example": true }; },
  };
  const r = await runRestore(root, {}, prompts);
  expect(r.kind).toBe("done");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toBe("PORT=3000\n");
});

test("cancelling the selection writes nothing", async () => {
  const root = await repoWithBackup("k1");
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=changed\n");
  const prompts: RestorePrompts = {
    async selectBackup() { return null; },
    async resolveConflicts() { throw new Error("should not reach conflicts"); },
  };
  const r = await runRestore(root, {}, prompts);
  expect(r.kind).toBe("cancelled");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toBe("PORT=changed\n");
});

test("cancelling conflict resolution writes nothing", async () => {
  const root = await repoWithBackup("k1");
  await Bun.write(join(root, "apps", "api", ".env"), "PORT=changed\n");
  const prompts: RestorePrompts = {
    async selectBackup() { return "k1"; },
    async resolveConflicts() { return null; },
  };
  const r = await runRestore(root, {}, prompts);
  expect(r.kind).toBe("cancelled");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toBe("PORT=changed\n");
});
