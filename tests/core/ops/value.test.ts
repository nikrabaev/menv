import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planSetValue, resolveMappingKey } from "../../../src/core/ops/value.ts";
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
