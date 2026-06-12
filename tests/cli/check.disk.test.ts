import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runCheck } from "../../src/cli/check.ts";
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

// Called directly (not via the entry point), runCheck EMITS the ok envelope on
// success but THROWS on errors — findings ride on the MenvError's `details`.
function passedFindings(io: ReturnType<typeof memoryIo>): string[] {
  return (JSON.parse(io.out.join("")).result.findings as { code: string }[]).map((f) => f.code);
}
function failedFindings(e: unknown): string[] {
  return ((e as MenvError).details as { code: string }[]).map((f) => f.code);
}

async function repo(): Promise<{ root: string; registry: Registry }> {
  const registry = makeRegistry();
  registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k-port" } } } } };
  const root = await tmpRepo(registry);
  roots.push(root);
  const s = await openVaultSession(root, registry, "local", FLAGS);
  await s.set("k-port", "3000");
  await s.close();
  return { root, registry };
}

describe("runCheck", () => {
  test("a freshly generated repo passes (exit 0)", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const io = memoryIo();
    await runCheck(root, registry, FLAGS, io); // resolves = exit 0
    const env = JSON.parse(io.out.join(""));
    expect(env.ok).toBe(true);
    expect(passedFindings(io)).not.toContain("STALE");
  });

  test("a hand-edited generated file is STALE", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const cur = await Bun.file(join(root, "apps/api/.env")).text();
    await Bun.write(join(root, "apps/api/.env"), `${cur}EXTRA=1\n`);
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect(failedFindings(e)).toContain("STALE");
    }
  });

  test("a foreign file at an expected path is FOREIGN_FILE", async () => {
    const { root, registry } = await repo();
    await Bun.write(join(root, "apps/api/.env"), "HAND=made\n");
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("FOREIGN_FILE");
    }
  });

  test("an unresolved interpolation reference is INTERPOLATION", async () => {
    const { root, registry } = await repo();
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-port", "${GHOST}");
    await s.close();
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("INTERPOLATION");
    }
  });

  test("a broken ref with an existing generated file still returns the findings list", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo()); // marked apps/api/.env on disk
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-port", "${GHOST}"); // now unresolved — the staleness preview would re-throw
    await s.close();
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect(Array.isArray((e as MenvError).details)).toBe(true); // findings preserved, not a bare throw
      expect(failedFindings(e)).toContain("INTERPOLATION");
    }
  });

  test("a compose marker naming an unknown consumer is COMPOSE_UNKNOWN_CONSUMER", async () => {
    const { root, registry } = await repo();
    registry.compose = { files: ["docker-compose.yml"] }; // runCheck reads the passed registry
    await Bun.write(join(root, "docker-compose.yml"), "x:\n  # <menv:ghost>\n  # </menv>\n");
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("COMPOSE_UNKNOWN_CONSUMER");
    }
  });
});
