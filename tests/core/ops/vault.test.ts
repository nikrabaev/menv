import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planVaultAdd, planVaultRemove, planVaultUpdate } from "../../../src/core/ops/vault.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

function withVar(name: string, vault: string, consumers: Record<string, string>) {
  const r = makeRegistry();
  r.variables[name] = {
    vaultMapping: {
      [vault]: Object.fromEntries(Object.entries(consumers).map(([c, key]) => [c, { key }])),
    },
  };
  return r;
}

describe("planVaultAdd", () => {
  test("adds the vault without mutating the input registry", () => {
    const r = makeRegistry();
    const { next, plan } = planVaultAdd(r, {
      name: "staging",
      vaultType: "menv-local",
      vaultConfig: { filename: ".menv/vault.staging.json", encryption: true },
    });
    expect(next.vaults.staging?.vaultType).toBe("menv-local");
    expect(r.vaults.staging).toBeUndefined();
    expect(plan.registry).toEqual([
      { action: "set", path: "vaults.staging", summary: 'add vault "staging" (menv-local)' },
    ]);
    expect(plan.blockers).toEqual([]);
  });

  test("rejects duplicates and bad names", () => {
    const r = makeRegistry();
    expect(() => planVaultAdd(r, { name: "local", vaultType: "menv-local", vaultConfig: {} })).toThrow(
      'vault "local" already exists',
    );
    try {
      planVaultAdd(r, { name: "Bad Name", vaultType: "menv-local", vaultConfig: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });
});

describe("planVaultUpdate", () => {
  test("merges config keys and can set the default", () => {
    const r = makeRegistry();
    const { next } = planVaultUpdate(r, { name: "production", config: { encryption: true }, makeDefault: true });
    expect(next.vaults.production?.vaultConfig).toEqual({
      filename: ".menv/vault.production.json",
      encryption: true,
    });
    expect(next.defaults.vault).toBe("production");
  });

  test("unknown vault → NOT_FOUND", () => {
    try {
      planVaultUpdate(makeRegistry(), { name: "ghost" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });
});

describe("planVaultRemove", () => {
  test("removing the default vault is a hard error", () => {
    try {
      planVaultRemove(makeRegistry(), { name: "local" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect((e as MenvError).message).toContain("default");
    }
  });

  test("mapping and global references become blockers; forced outcome cascades", () => {
    const r = withVar("DATABASE_URL", "production", { api: "k1" });
    r.globals.FQDN = { values: { production: { source: "runtime" } } };
    const { next, plan } = planVaultRemove(r, { name: "production" });
    const codes = plan.blockers.map((b) => b.code);
    expect(codes).toContain("VAULT_IN_USE");
    expect(plan.blockers.some((b) => b.message.includes("DATABASE_URL"))).toBe(true);
    expect(plan.blockers.some((b) => b.message.includes("FQDN"))).toBe(true);
    expect(next.vaults.production).toBeUndefined();
    expect(next.variables.DATABASE_URL?.vaultMapping.production).toBeUndefined();
    expect(next.globals.FQDN?.values.production).toBeUndefined();
    expect(plan.vaults).toEqual([]); // the store itself is never touched
  });

  test("an unreferenced vault removes with no blockers", () => {
    const { plan } = planVaultRemove(makeRegistry(), { name: "production" });
    expect(plan.blockers).toEqual([]);
  });
});
