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

  test("already-wired consumer / key+shared together → VALIDATION", () => {
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

  test("removes entries; key kept while another consumer uses it, removed when orphaned", () => {
    const first = planUnwire(wired(), {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["api"],
      records: [],
      unverified: [],
      openable: new Set(["local"]),
    });
    expect(first.plan.vaults).toEqual([]); // web still uses "shared"
    const second = planUnwire(first.next, {
      name: "DATABASE_URL",
      vault: "local",
      consumers: ["web"],
      records: [],
      unverified: [],
      openable: new Set(["local"]),
    });
    expect(second.plan.vaults).toEqual([{ vault: "local", action: "remove", key: "shared" }]);
    expect(second.next.variables.DATABASE_URL?.vaultMapping.local).toBeUndefined();
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
