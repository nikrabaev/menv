import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runBackup, runRestore } from "../../src/cli/backupCmd.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import { memoryIo } from "../../src/cli/output.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

async function repo() {
  const registry = makeRegistry();
  registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k" } } } } };
  const root = await tmpRepo(registry);
  roots.push(root);
  const s = await openVaultSession(root, registry, "local", FLAGS);
  await s.set("k", "3000");
  await s.close();
  await runGenerate(root, registry, {}, FLAGS, memoryIo());
  return { root, registry };
}

const NO_TTY = { isTTY: false, pick: async () => "", confirm: async () => true };

describe("runBackup / runRestore", () => {
  test("backup then restore --force round-trips a wiped file", async () => {
    const { root, registry } = await repo();
    const io = memoryIo();
    await runBackup(root, registry, FLAGS, io);
    const key = JSON.parse(io.out.join("")).result.key as string;
    await Bun.write(join(root, "apps/api/.env"), "WIPED=1\n");
    await runRestore(root, { key, force: true }, FLAGS, memoryIo(), NO_TTY);
    expect(await Bun.file(join(root, "apps/api/.env")).text()).not.toBe("WIPED=1\n");
  });

  test("restore without a key and no TTY is a usage error", async () => {
    const { root } = await repo();
    await runBackup(root, makeRegistry(), FLAGS, memoryIo());
    try {
      await runRestore(root, { force: true }, FLAGS, memoryIo(), NO_TTY);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });

  test("restore with a key but no --force and no TTY refuses to overwrite", async () => {
    const { root, registry } = await repo();
    const io = memoryIo();
    await runBackup(root, registry, FLAGS, io);
    const key = JSON.parse(io.out.join("")).result.key as string;
    try {
      await runRestore(root, { key, force: false }, FLAGS, memoryIo(), NO_TTY);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });
});
