import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { mergePlans, newPlan } from "../../../src/core/ops/util.ts";
import { planSetUniqueValue, planSetValue, resolveMappingKey } from "../../../src/core/ops/value.ts";
import { planToJson, renderPlanPretty } from "../../../src/core/plan.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

function wired() {
  const r = makeRegistry();
  r.variables.DATABASE_URL = {
    secret: true,
    vaultMapping: {
      local: { api: { key: "shared" }, web: { key: "shared" } },
      production: { api: { key: "pa" }, web: { key: "pw" } },
    },
  };
  return r;
}

describe("resolveMappingKey", () => {
  test("explicit consumer wins; one distinct key is unambiguous", () => {
    expect(resolveMappingKey(wired(), { name: "DATABASE_URL", vault: "production", consumer: "api" }).key).toBe("pa");
    const shared = resolveMappingKey(wired(), { name: "DATABASE_URL", vault: "local" });
    expect(shared.key).toBe("shared");
    expect(shared.consumers.sort()).toEqual(["api", "web"]);
  });

  test("multiple distinct keys without --consumer → AMBIGUOUS listing options", () => {
    try {
      resolveMappingKey(wired(), { name: "DATABASE_URL", vault: "production" });
      expect.unreachable();
    } catch (e) {
      const err = e as MenvError;
      expect(err.code).toBe("AMBIGUOUS");
      expect(err.message).toContain("--consumer");
      expect(err.message).toContain("api");
      expect(err.message).toContain("web");
    }
  });

  test("unwired vault / unknown consumer → NOT_FOUND", () => {
    const r = makeRegistry();
    r.variables.X = { vaultMapping: {} };
    try {
      resolveMappingKey(r, { name: "X", vault: "local" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
    try {
      resolveMappingKey(wired(), { name: "DATABASE_URL", vault: "local", consumer: "ghost" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });
});

describe("planSetValue", () => {
  test("produces one vault set op and leaves the registry untouched", () => {
    const r = wired();
    const { next, plan } = planSetValue(r, { name: "DATABASE_URL", vault: "local", value: "postgres://x" });
    expect(next).toBe(r);
    expect(plan.registry).toEqual([]);
    expect(plan.vaults).toEqual([{ vault: "local", action: "set", key: "shared", value: "postgres://x" }]);
  });

  // Deferred review finding from Plan 1: NO field of the rendered plan — JSON
  // or pretty — may carry the value. Only VaultOp.value holds it, for execution.
  test("the secret value appears in no rendered plan output", () => {
    const SECRET = "postgres://user:hunter2@host/db";
    const { plan } = planSetValue(wired(), { name: "DATABASE_URL", vault: "local", value: SECRET });
    expect(JSON.stringify(planToJson(plan))).not.toContain(SECRET);
    expect(renderPlanPretty(plan)).not.toContain(SECRET);
  });
});

describe("planSetUniqueValue", () => {
  const newKey = () => "fresh-key";

  test("solo key: no re-key, one vault set at the existing key", () => {
    const r = wired();
    // In production, api→pa and web→pw — api's key is not shared.
    const { next, plan } = planSetUniqueValue(r, {
      name: "DATABASE_URL",
      vault: "production",
      consumer: "api",
      value: "v-api",
      newKey,
    });
    expect(next).toBe(r);
    expect(plan.registry).toEqual([]);
    expect(plan.vaults).toEqual([{ vault: "production", action: "set", key: "pa", value: "v-api" }]);
  });

  test("shared key: re-keys this consumer onto a fresh key and leaves sharers untouched", () => {
    const r = wired();
    // In local, api and web both point at "shared".
    const { next, plan } = planSetUniqueValue(r, {
      name: "DATABASE_URL",
      vault: "local",
      consumer: "api",
      value: "only-api",
      newKey,
    });
    expect(next).not.toBe(r);
    const mapping = next.variables.DATABASE_URL?.vaultMapping.local;
    expect(mapping?.api?.key).toBe("fresh-key");
    expect(mapping?.web?.key).toBe("shared"); // sharer untouched
    // input registry is never mutated
    expect(r.variables.DATABASE_URL?.vaultMapping.local?.api?.key).toBe("shared");
    expect(plan.registry).toHaveLength(1);
    expect(plan.registry[0]?.path).toBe("variables.DATABASE_URL.vaultMapping.local.api.key");
    // value lands on the NEW key; the old shared key is never written or removed
    expect(plan.vaults).toEqual([{ vault: "local", action: "set", key: "fresh-key", value: "only-api" }]);
  });

  test("unwired consumer → NOT_FOUND", () => {
    const r = makeRegistry();
    r.variables.X = { vaultMapping: {} };
    try {
      planSetUniqueValue(r, { name: "X", vault: "local", consumer: "api", value: "v", newKey });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });

  test("the secret value appears in no rendered plan output (shared re-key path)", () => {
    const SECRET = "postgres://user:hunter2@host/db";
    const { plan } = planSetUniqueValue(wired(), {
      name: "DATABASE_URL",
      vault: "local",
      consumer: "api",
      value: SECRET,
      newKey,
    });
    expect(JSON.stringify(planToJson(plan))).not.toContain(SECRET);
    expect(renderPlanPretty(plan)).not.toContain(SECRET);
  });
});

describe("mergePlans", () => {
  test("concatenates every section of two plans in order", () => {
    const a = newPlan();
    a.registry.push({ action: "set", path: "p.a", summary: "a" });
    a.vaults.push({ vault: "local", action: "set", key: "ka", value: "va" });
    a.warnings.push({ code: "W", message: "wa" });
    const b = newPlan();
    b.registry.push({ action: "set", path: "p.b", summary: "b" });
    b.vaults.push({ vault: "local", action: "set", key: "kb", value: "vb" });
    b.blockers.push({ code: "X", message: "xb" });

    const merged = mergePlans(a, b);
    expect(merged.registry.map((o) => o.path)).toEqual(["p.a", "p.b"]);
    expect(merged.vaults.map((o) => o.key)).toEqual(["ka", "kb"]);
    expect(merged.warnings.map((w) => w.code)).toEqual(["W"]);
    expect(merged.blockers.map((bl) => bl.code)).toEqual(["X"]);
    // inputs are not mutated
    expect(a.registry).toHaveLength(1);
    expect(b.registry).toHaveLength(1);
  });
});
