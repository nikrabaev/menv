import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planVarDefine, planVarRemove, planVarUpdate } from "../../../src/core/ops/variable.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

function withWiredVar() {
  const r = makeRegistry();
  r.variables.DATABASE_URL = {
    groupKey: "db",
    secret: true,
    vaultMapping: {
      local: { api: { key: "k1" }, web: { key: "k1" } },
      production: { api: { key: "k2" } },
    },
  };
  return r;
}

describe("planVarDefine", () => {
  test("defines with metadata and empty mapping", () => {
    const { next, plan } = planVarDefine(makeRegistry(), {
      name: "REDIS_URL",
      groupKey: "db",
      secret: true,
      description: "Redis",
      example: "redis://localhost:6379",
    });
    expect(next.variables.REDIS_URL).toEqual({
      groupKey: "db",
      secret: true,
      description: "Redis",
      example: "redis://localhost:6379",
      vaultMapping: {},
    });
    expect(plan.registry[0]?.path).toBe("variables.REDIS_URL");
  });

  test("bad name / duplicate / unknown group", () => {
    expect(() => planVarDefine(makeRegistry(), { name: "1bad" })).toThrow("invalid variable name");
    const r = withWiredVar();
    try {
      planVarDefine(r, { name: "DATABASE_URL" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
    try {
      planVarDefine(makeRegistry(), { name: "X", groupKey: "ghost" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });
});

describe("planVarUpdate", () => {
  test("updates fields; clearGroup drops the group", () => {
    const { next } = planVarUpdate(withWiredVar(), {
      name: "DATABASE_URL",
      secret: false,
      description: "d",
      clearGroup: true,
    });
    const def = next.variables.DATABASE_URL;
    expect(def?.secret).toBe(false);
    expect(def?.description).toBe("d");
    expect(def?.groupKey).toBeUndefined();
  });
});

describe("planVarRemove", () => {
  test("removes keys per wired vault; dependents and unverified gate", () => {
    const { next, plan } = planVarRemove(withWiredVar(), {
      name: "DATABASE_URL",
      records: [
        { variable: "HEALTH_URL", vault: "local", consumer: "api", raw: "${DATABASE_URL}/health" },
        { variable: "OTHER", vault: "local", consumer: "api", raw: "plain" },
      ],
      unverified: ["production"],
      openable: new Set(["local"]),
    });
    expect(next.variables.DATABASE_URL).toBeUndefined();
    // k1 shared by api+web → ONE remove op; production locked → no op, warning
    expect(plan.vaults).toEqual([{ vault: "local", action: "remove", key: "k1" }]);
    expect(plan.warnings.some((w) => w.code === "ORPHANED_KEYS" && w.message.includes("production"))).toBe(true);
    const codes = plan.blockers.map((b) => b.code);
    expect(codes).toContain("DEPENDENT_REFERENCE");
    expect(codes).toContain("UNVERIFIED_REFERENCES");
  });

  test("unwired variable removes clean", () => {
    const r = makeRegistry();
    r.variables.X = { vaultMapping: {} };
    const { plan } = planVarRemove(r, { name: "X", records: [], unverified: [], openable: new Set() });
    expect(plan.blockers).toEqual([]);
    expect(plan.vaults).toEqual([]);
  });
});
