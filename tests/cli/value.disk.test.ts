import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { memoryIo } from "../../src/cli/output.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import { runGet, runSet } from "../../src/cli/value.ts";
import type { MenvError } from "../../src/core/errors.ts";
import type { Registry } from "../../src/registry/types.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const FLAGS = { dryRun: false, force: false, mode: "pretty" as const, vaultAuth: {}, env: {} };

async function repo(): Promise<{ root: string; registry: Registry }> {
  const registry = makeRegistry();
  registry.variables.DATABASE_URL = { secret: true, vaultMapping: { local: { api: { key: "k1" } } } };
  const root = await tmpRepo(registry);
  roots.push(root);
  return { root, registry };
}

describe("runSet / runGet", () => {
  test("set (defaults.vault) then get round-trips raw, no trailing newline", async () => {
    const { root, registry } = await repo();
    await runSet(root, registry, { name: "DATABASE_URL", valueArg: "postgres://x" }, FLAGS, memoryIo());
    const io = memoryIo();
    await runGet(root, registry, { name: "DATABASE_URL" }, FLAGS, io);
    expect(io.out.join("")).toBe("postgres://x"); // raw — $(menv get …) stays clean
  });

  test("get --output json wraps in the envelope", async () => {
    const { root, registry } = await repo();
    await runSet(root, registry, { name: "DATABASE_URL", valueArg: "v" }, FLAGS, memoryIo());
    const io = memoryIo();
    await runGet(root, registry, { name: "DATABASE_URL" }, { ...FLAGS, mode: "json" }, io);
    expect(JSON.parse(io.out.join(""))).toEqual({
      ok: true,
      result: { name: "DATABASE_URL", vault: "local", value: "v" },
    });
  });

  test("get with no stored value → NOT_FOUND", async () => {
    const { root, registry } = await repo();
    try {
      await runGet(root, registry, { name: "DATABASE_URL" }, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });

  test("set --dry-run leaves the vault untouched and leaks no value", async () => {
    const { root, registry } = await repo();
    const io = memoryIo();
    await runSet(
      root,
      registry,
      { name: "DATABASE_URL", valueArg: "hunter2" },
      { ...FLAGS, dryRun: true, mode: "json" },
      io,
    );
    expect(io.out.join("")).not.toContain("hunter2");
    const s = await openVaultSession(root, registry, "local", FLAGS);
    expect(await s.get("k1")).toBeUndefined();
    await s.close();
  });
});
