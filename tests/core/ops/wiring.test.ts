import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planSetDisabled, planUnwire, planWire } from "../../../src/core/ops/wiring.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

function seq(): () => string {
  let n = 0;
  return () => `key-${++n}`;
}

function withVar() {
  const r = makeRegistry();
  r.variables.DATABASE_URL = { vaultMapping: {} };
  return r;
}

describe("planWire", () => {
  test("default: one fresh key per consumer", () => {
    const { next } = planWire(withVar(), {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api", "web"],
      newKey: seq(),
    });
    expect(next.variables.DATABASE_URL?.vaultMapping.local).toEqual({
      api: { key: "key-1" },
      web: { key: "key-2" },
    });
  });

  test("--shared: one key for all; --key joins an existing key", () => {
    const shared = planWire(withVar(), {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api", "web"],
      shared: true,
      newKey: seq(),
    });
    expect(shared.next.variables.DATABASE_URL?.vaultMapping.local).toEqual({
      api: { key: "key-1" },
      web: { key: "key-1" },
    });
    const joined = planWire(shared.next, {
      name: "DATABASE_URL",
      vault: "production",
      consumers: ["api"],
      key: "prod/db",
      newKey: seq(),
    });
    expect(joined.next.variables.DATABASE_URL?.vaultMapping.production).toEqual({ api: { key: "prod/db" } });
  });

  test("already-wired consumer (no --key) / key+shared together → VALIDATION", () => {
    const { next } = planWire(withVar(), { name: "DATABASE_URL", vault: "local", consumers: ["api"], newKey: seq() });
    try {
      planWire(next, { name: "DATABASE_URL", vault: "local", consumers: ["api"], newKey: seq() });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).message).toContain("already wired");
    }
    expect(() =>
      planWire(withVar(), {
        name: "DATABASE_URL",
        vault: "local",
        consumers: ["api"],
        shared: true,
        key: "k",
        newKey: seq(),
      }),
    ).toThrow("mutually exclusive");
  });

  test("--key re-keys an already-wired consumer; old solo key orphaned → removed with --remove-orphans", () => {
    const base = planWire(withVar(), { name: "DATABASE_URL", vault: "local", consumers: ["api", "web"], newKey: seq() }).next;
    // api→key-1, web→key-2
    const rekey = planWire(base, {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api"],
      key: "key-2", // join web's key
      removeOrphans: true,
      openable: new Set(["local"]),
      newKey: seq(),
    });
    expect(rekey.next.variables.DATABASE_URL?.vaultMapping.local).toEqual({
      api: { key: "key-2" },
      web: { key: "key-2" },
    });
    expect(rekey.plan.vaults).toEqual([{ vault: "local", action: "remove", key: "key-1" }]); // api's vacated key
  });

  test("re-key preserves the disabled flag", () => {
    const r = withVar();
    r.variables.DATABASE_URL = { vaultMapping: { local: { api: { key: "k1", disabled: true }, web: { key: "k2" } } } };
    const rekey = planWire(r, {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api"],
      key: "k2",
      removeOrphans: true,
      openable: new Set(["local"]),
      newKey: seq(),
    });
    expect(rekey.next.variables.DATABASE_URL?.vaultMapping.local?.api).toEqual({ key: "k2", disabled: true });
    expect(rekey.plan.vaults).toEqual([{ vault: "local", action: "remove", key: "k1" }]);
  });

  test("re-key keeps the orphan by default (opt-in), surfaced as a warning", () => {
    const base = planWire(withVar(), { name: "DATABASE_URL", vault: "local", consumers: ["api", "web"], newKey: seq() }).next;
    const rekey = planWire(base, { name: "DATABASE_URL", vault: "local", consumers: ["api"], key: "key-2", newKey: seq() });
    expect(rekey.plan.vaults).toEqual([]); // not removed without --remove-orphans
    expect(rekey.plan.warnings.some((w) => w.code === "ORPHANED_KEYS")).toBe(true);
  });

  test("re-keying onto the consumer's current key is a no-op (no orphan)", () => {
    const base = planWire(withVar(), { name: "DATABASE_URL", vault: "local", consumers: ["api"], newKey: seq() }).next; // api→key-1
    const same = planWire(base, {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api"],
      key: "key-1",
      removeOrphans: true,
      openable: new Set(["local"]),
      newKey: seq(),
    });
    expect(same.plan.registry).toEqual([]);
    expect(same.plan.vaults).toEqual([]);
  });
});

describe("planUnwire", () => {
  function wired() {
    const r = makeRegistry();
    r.variables.DATABASE_URL = {
      vaultMapping: { local: { api: { key: "shared" }, web: { key: "shared" } } },
    };
    r.variables.HEALTH_URL = { vaultMapping: { local: { api: { key: "h" } } } };
    return r;
  }

  test("removes entries; orphaned key removed when openable AND --remove-orphans", () => {
    const first = planUnwire(wired(), {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api"],
      records: [],
      unverified: [],
      openable: new Set(["local"]),
      removeOrphans: true,
    });
    expect(first.plan.vaults).toEqual([]); // web still uses "shared"
    const second = planUnwire(first.next, {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["web"],
      records: [],
      unverified: [],
      openable: new Set(["local"]),
      removeOrphans: true,
    });
    expect(second.plan.vaults).toEqual([{ vault: "local", action: "remove", key: "shared" }]);
    expect(second.next.variables.DATABASE_URL?.vaultMapping.local).toBeUndefined();
  });

  test("orphans are KEPT by default (opt-in via removeOrphans), surfaced as a warning", () => {
    const first = planUnwire(wired(), {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api"],
      records: [],
      unverified: [],
      openable: new Set(["local"]),
    });
    const second = planUnwire(first.next, {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["web"],
      records: [],
      unverified: [],
      openable: new Set(["local"]),
    });
    expect(second.plan.vaults).toEqual([]); // not removed without removeOrphans
    expect(second.plan.warnings.some((w) => w.code === "ORPHANED_KEYS")).toBe(true);
  });

  test("a same-scope reference to the unwired variable is a blocker", () => {
    const { plan } = planUnwire(wired(), {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api"],
      records: [{ variable: "HEALTH_URL", vault: "local", consumer: "api", raw: "${DATABASE_URL}/health" }],
      unverified: [],
      openable: new Set(["local"]),
    });
    expect(plan.blockers.some((b) => b.code === "DEPENDENT_REFERENCE")).toBe(true);
  });

  test("not-wired consumer → VALIDATION", () => {
    try {
      planUnwire(wired(), {
        name: "HEALTH_URL",
        vault: "local",
        consumers: ["web"],
        records: [],
        unverified: [],
        openable: new Set(),
      });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });
});

describe("planSetDisabled", () => {
  test("toggles; already-in-state is a NOOP warning", () => {
    const r = makeRegistry();
    r.variables.X = { vaultMapping: { local: { api: { key: "k" } } } };
    const off = planSetDisabled(r, { name: "X", vault: "local", consumer: "api", disabled: true });
    expect(off.next.variables.X?.vaultMapping.local?.api).toEqual({ key: "k", disabled: true });
    const on = planSetDisabled(off.next, { name: "X", vault: "local", consumer: "api", disabled: false });
    expect(on.next.variables.X?.vaultMapping.local?.api).toEqual({ key: "k" });
    const noop = planSetDisabled(on.next, { name: "X", vault: "local", consumer: "api", disabled: false });
    expect(noop.plan.warnings.some((w) => w.code === "NOOP")).toBe(true);
    expect(noop.plan.registry).toEqual([]);
  });
});
