import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planConsumerAdd, planConsumerRemove, planConsumerUpdate } from "../../../src/core/ops/consumer.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

describe("planConsumerAdd", () => {
  test("adds a single-strategy consumer", () => {
    const { next, plan } = planConsumerAdd(makeRegistry(), {
      name: "worker",
      strategyType: "single",
      baseDir: "apps/worker",
      filename: ".env",
    });
    expect(next.consumers.worker).toEqual({
      strategyType: "single",
      strategyConfig: { baseDir: "apps/worker", filename: ".env" },
    });
    expect(plan.registry[0]?.path).toBe("consumers.worker");
  });

  test("per-vault requires filenames keyed by known vaults", () => {
    const { next } = planConsumerAdd(makeRegistry(), {
      name: "site",
      strategyType: "per-vault",
      baseDir: "apps/site",
      filenames: { local: ".env.development", production: ".env.production" },
      secretsAsLocalOverrides: true,
      example: true,
    });
    expect(next.consumers.site?.strategyType).toBe("per-vault");
    try {
      planConsumerAdd(makeRegistry(), {
        name: "bad",
        strategyType: "per-vault",
        baseDir: "x",
        filenames: { ghost: ".env" },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });

  test("single without filename, duplicates, bad names → VALIDATION", () => {
    const r = makeRegistry();
    expect(() => planConsumerAdd(r, { name: "x", strategyType: "single", baseDir: "x" })).toThrow(
      "single strategy needs --filename",
    );
    try {
      planConsumerAdd(r, { name: "api", strategyType: "single", baseDir: "x", filename: ".env" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });
});

describe("planConsumerUpdate", () => {
  test("updates fields compatible with the current strategy", () => {
    const { next } = planConsumerUpdate(makeRegistry(), { name: "api", baseDir: "services/api", example: true });
    const def = next.consumers.api;
    expect(def?.strategyConfig.baseDir).toBe("services/api");
    expect(def?.strategyConfig.example).toBe(true);
  });

  test("filename on a per-vault consumer → VALIDATION", () => {
    const r = makeRegistry();
    r.consumers.site = {
      strategyType: "per-vault",
      strategyConfig: { baseDir: "apps/site", filenames: { local: ".env.development" } },
    };
    try {
      planConsumerUpdate(r, { name: "site", filename: ".env" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });
});

describe("planConsumerRemove", () => {
  test("cascades mapping entries and removes orphaned keys in openable vaults", () => {
    const r = makeRegistry();
    r.variables.DATABASE_URL = {
      vaultMapping: {
        local: { api: { key: "shared" }, web: { key: "shared" } },
        production: { api: { key: "solo" } },
      },
    };
    const { next, plan } = planConsumerRemove(r, { name: "api", openable: new Set(["local", "production"]) });
    expect(next.consumers.api).toBeUndefined();
    expect(next.variables.DATABASE_URL?.vaultMapping.local).toEqual({ web: { key: "shared" } });
    expect(next.variables.DATABASE_URL?.vaultMapping.production).toBeUndefined();
    // "shared" still used by web → kept; "solo" orphaned → removed
    expect(plan.vaults).toEqual([{ vault: "production", action: "remove", key: "solo" }]);
    expect(plan.blockers).toEqual([]);
  });

  test("orphans in an unopenable vault become a warning, not a vault op", () => {
    const r = makeRegistry();
    r.variables.X = { vaultMapping: { production: { api: { key: "k" } } } };
    const { plan } = planConsumerRemove(r, { name: "api", openable: new Set(["local"]) });
    expect(plan.vaults).toEqual([]);
    expect(plan.warnings.some((w) => w.code === "ORPHANED_KEYS")).toBe(true);
  });
});
