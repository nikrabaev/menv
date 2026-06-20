import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { memoryIo } from "../../src/cli/output.ts";
import { collectValueRecords, openVaultSession, runMutation } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { planGroupAdd } from "../../src/core/ops/group.ts";
import { planSetValue } from "../../src/core/ops/value.ts";
import { planVarRemove } from "../../src/core/ops/variable.ts";
import { loadRegistry } from "../../src/registry/persist.ts";
import type { Registry } from "../../src/registry/types.ts";
import type { VaultSession } from "../../src/vault/provider.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

async function repoWithValue(): Promise<{ root: string; registry: Registry }> {
  const registry = makeRegistry();
  registry.variables.DATABASE_URL = { vaultMapping: { local: { api: { key: "k1" } } } };
  const root = await tmpRepo(registry);
  roots.push(root);
  const session = await openVaultSession(root, registry, "local", { vaultAuth: {}, env: {} });
  await session.set("k1", "postgres://localhost/app");
  await session.close();
  return { root, registry };
}

describe("openVaultSession", () => {
  test("opens a plaintext local vault with no auth anywhere", async () => {
    const { root, registry } = await repoWithValue();
    const s = await openVaultSession(root, registry, "local", { vaultAuth: {}, env: {} });
    expect(await s.get("k1")).toBe("postgres://localhost/app");
    await s.close();
  });

  test("encrypted vault, no auth, no prompt → AUTH_MISSING", async () => {
    const registry = makeRegistry();
    registry.vaults.sealed = {
      vaultType: "menv-local",
      vaultConfig: { filename: ".menv/vault.sealed.json", encryption: true },
    };
    const root = await tmpRepo(registry);
    roots.push(root);
    await Bun.write(join(root, ".menv/vault.sealed.json"), "x"); // existing file forces a decrypt attempt
    try {
      await openVaultSession(root, registry, "sealed", { vaultAuth: {}, env: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("AUTH_MISSING");
    }
  });

  test("AUTH_MISSING retries once via promptFn when provided", async () => {
    const registry = makeRegistry();
    registry.vaults.sealed = {
      vaultType: "menv-local",
      vaultConfig: { filename: ".menv/vault.sealed.json", encryption: true },
    };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "sealed", { vaultAuth: {}, env: {} }, async () => "pw");
    await s.set("k", "v");
    await s.close();
    const reopened = await openVaultSession(root, registry, "sealed", { vaultAuth: { sealed: "pw" }, env: {} });
    expect(await reopened.get("k")).toBe("v");
    await reopened.close();
  });
});

describe("collectValueRecords", () => {
  test("collects records from openable vaults and lists unopenable ones", async () => {
    const { root, registry } = await repoWithValue();
    registry.vaults.sealed = {
      vaultType: "menv-local",
      vaultConfig: { filename: ".menv/vault.sealed.json", encryption: true },
    };
    registry.variables.DATABASE_URL = {
      vaultMapping: {
        local: { api: { key: "k1" } },
        sealed: { api: { key: "k9" } },
      },
    };
    await Bun.write(join(root, ".menv/vault.sealed.json"), "x");
    const scan = await collectValueRecords(root, registry, ["local", "sealed"], { vaultAuth: {}, env: {} });
    expect(scan.records).toEqual([
      { variable: "DATABASE_URL", vault: "local", consumer: "api", raw: "postgres://localhost/app" },
    ]);
    expect(scan.unverified).toEqual(["sealed"]);
    expect(scan.openable.has("local")).toBe(true);
    for (const s of scan.sessions.values()) await s.close();
  });
});

describe("runMutation", () => {
  test("dry-run prints the plan and changes nothing", async () => {
    const { root, registry } = await repoWithValue();
    const io = memoryIo();
    const op = planSetValue(registry, { name: "DATABASE_URL", vault: "local", value: "CHANGED" });
    await runMutation(root, registry, op, { dryRun: true, force: false, mode: "json", vaultAuth: {}, env: {} }, io);
    const envelope = JSON.parse(io.out.join(""));
    expect(envelope.ok).toBe(true);
    expect(envelope.result.dryRun).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain("CHANGED");
    const s = await openVaultSession(root, registry, "local", { vaultAuth: {}, env: {} });
    expect(await s.get("k1")).toBe("postgres://localhost/app");
    await s.close();
  });

  test("executes vault ops and saves the next registry", async () => {
    const { root, registry } = await repoWithValue();
    const io = memoryIo();
    const op = planVarRemove(registry, {
      name: "DATABASE_URL",
      records: [],
      unverified: [],
      openable: new Set(["local"]),
    });
    await runMutation(root, registry, op, { dryRun: false, force: false, mode: "pretty", vaultAuth: {}, env: {} }, io);
    const saved = await loadRegistry(root);
    expect(saved.variables.DATABASE_URL).toBeUndefined();
    const s = await openVaultSession(root, saved, "local", { vaultAuth: {}, env: {} });
    expect(await s.get("k1")).toBeUndefined();
    await s.close();
    expect(io.out.join("")).toContain("applied");
  });

  test("blockers fail with BLOCKED unless force", async () => {
    const { root, registry } = await repoWithValue();
    const op = planVarRemove(registry, {
      name: "DATABASE_URL",
      records: [{ variable: "OTHER", vault: "local", consumer: "api", raw: "${DATABASE_URL}" }],
      unverified: [],
      openable: new Set(["local"]),
    });
    try {
      await runMutation(root, registry, op, { dryRun: false, force: false, mode: "pretty", vaultAuth: {}, env: {} }, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("BLOCKED");
    }
    await runMutation(root, registry, op, { dryRun: false, force: true, mode: "pretty", vaultAuth: {}, env: {} }, memoryIo());
    expect((await loadRegistry(root)).variables.DATABASE_URL).toBeUndefined();
  });

  // Regression: a rejecting close() must not leak the other sessions nor mask
  // the real outcome. Latent today (local close() is a no-op) but the provider
  // contract allows a close() that rejects (e.g. a remote token revoke).
  test("closes every passed-in session even if one close() rejects", async () => {
    const { root, registry } = await repoWithValue();
    const closed: string[] = [];
    const fake = (name: string, throwOnClose: boolean): VaultSession => ({
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
      list: async () => [],
      close: async () => {
        if (throwOnClose) throw new Error(`close-${name}-failed`);
        closed.push(name);
      },
    });
    const sessions = new Map<string, VaultSession>([
      ["a", fake("a", true)],
      ["b", fake("b", false)],
    ]);
    // A registry-only op (no vault ops): runMutation opens nothing new and
    // closes the passed-in sessions in its finally.
    const op = planGroupAdd(registry, { key: "payments", title: "Payments" });
    await runMutation(
      root,
      registry,
      op,
      { dryRun: false, force: false, mode: "pretty", vaultAuth: {}, env: {} },
      memoryIo(),
      sessions,
    );
    expect(closed).toEqual(["b"]); // "b" closed despite "a" throwing
    expect((await loadRegistry(root)).groups.payments).toBeDefined(); // result not masked
  });
});
