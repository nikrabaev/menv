import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runGenerate } from "../../src/cli/generate.ts";
import { memoryIo } from "../../src/cli/output.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import type { Registry } from "../../src/registry/types.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

async function repo(): Promise<{ root: string; registry: Registry }> {
  const registry = makeRegistry();
  registry.variables = {
    PORT: { vaultMapping: { local: { api: { key: "k-port" } } } },
    URL: { vaultMapping: { local: { api: { key: "k-url" } } } },
  };
  const root = await tmpRepo(registry);
  roots.push(root);
  const s = await openVaultSession(root, registry, "local", FLAGS);
  await s.set("k-port", "3000");
  await s.set("k-url", "http://localhost:${PORT}");
  await s.close();
  return { root, registry };
}

describe("runGenerate", () => {
  test("writes the consumer's .env with interpolation; result lists paths not values", async () => {
    const { root, registry } = await repo();
    const io = memoryIo();
    await runGenerate(root, registry, {}, FLAGS, io);
    const env = await Bun.file(join(root, "apps/api/.env")).text();
    expect(env).toContain("URL=http://localhost:3000");
    const envelope = JSON.parse(io.out.join(""));
    expect(envelope.result.written).toContain("apps/api/.env");
    expect(io.out.join("")).not.toContain("3000"); // values never in the result envelope
  });

  test("--dry-run writes nothing", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, { ...FLAGS, dryRun: true }, memoryIo());
    expect(await Bun.file(join(root, "apps/api/.env")).exists()).toBe(false);
  });

  test("a second run reports unchanged and rewrites nothing", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const io = memoryIo();
    await runGenerate(root, registry, {}, FLAGS, io);
    expect(JSON.parse(io.out.join("")).result.unchanged).toContain("apps/api/.env");
  });

  test("an interpolation cycle is a domain error (exit 1), nothing written", async () => {
    const { root, registry } = await repo();
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-url", "${URL}");
    await s.close();
    try {
      await runGenerate(root, registry, {}, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
    expect(await Bun.file(join(root, "apps/api/.env")).exists()).toBe(false);
  });
});
