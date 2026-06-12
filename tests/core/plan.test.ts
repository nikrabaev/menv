import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../src/core/errors.ts";
import type { Plan } from "../../src/core/plan.ts";
import { emptyPlan, executePlan, planToJson, renderPlanPretty } from "../../src/core/plan.ts";
import type { VaultSession } from "../../src/vault/provider.ts";

function fakeSession(log: string[]): VaultSession {
  return {
    async get() {
      return undefined;
    },
    async set(key, value) {
      log.push(`set ${key}=${value}`);
    },
    async remove(key) {
      log.push(`remove ${key}`);
    },
    async list() {
      return [];
    },
    async close() {},
  };
}

function makePlan(): Plan {
  return {
    registry: [{ action: "remove", path: "variables.OLD", summary: "remove variable OLD" }],
    vaults: [
      { vault: "local", action: "set", key: "k1", value: "secret-value" },
      { vault: "local", action: "remove", key: "k2" },
    ],
    files: [{ action: "write", path: "apps/api/.env" }],
    blockers: [],
    warnings: [{ code: "UNVERIFIED_REFERENCES", message: "vault production could not be opened" }],
  };
}

describe("plan rendering", () => {
  test("pretty render covers every op; empty plan says no changes", () => {
    const text = renderPlanPretty(makePlan());
    expect(text).toContain("variables.OLD");
    expect(text).toContain("vault local: set k1");
    expect(text).toContain("file write apps/api/.env");
    expect(text).toContain("UNVERIFIED_REFERENCES");
    expect(renderPlanPretty(emptyPlan())).toBe("no changes");
  });

  test("JSON form never contains vault values, only keys", () => {
    const json = JSON.stringify(planToJson(makePlan()));
    expect(json).toContain('"k1"');
    expect(json).not.toContain("secret-value");
  });
});

describe("executePlan", () => {
  test("blockers prevent execution unless force", async () => {
    const plan = { ...emptyPlan(), blockers: [{ code: "DEPENDENT_REFERENCE", message: "X" }] };
    const log: string[] = [];
    try {
      await executePlan(plan, { sessions: new Map([["local", fakeSession(log)]]) });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("BLOCKED");
    }
    await executePlan(plan, { force: true, sessions: new Map() }); // no ops — succeeds
  });

  test("applies vault ops in order, then commits the registry", async () => {
    const log: string[] = [];
    await executePlan(makePlan(), {
      sessions: new Map([["local", fakeSession(log)]]),
      commitRegistry: async () => {
        log.push("commit-registry");
      },
    });
    expect(log).toEqual(["set k1=secret-value", "remove k2", "commit-registry"]);
  });

  test("a vault op against a missing session → VAULT_IO", async () => {
    try {
      await executePlan(makePlan(), { sessions: new Map() });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VAULT_IO");
    }
  });

  test("applyFileOp runs for each file op after vault ops, before commit", async () => {
    const log: string[] = [];
    await executePlan(makePlan(), {
      sessions: new Map([["local", fakeSession(log)]]),
      commitRegistry: async () => {
        log.push("commit-registry");
      },
      applyFileOp: async (op) => {
        log.push(`file ${op.action} ${op.path}`);
      },
    });
    expect(log).toEqual(["set k1=secret-value", "remove k2", "file write apps/api/.env", "commit-registry"]);
  });

  test("without applyFileOp, file ops remain descriptive only", async () => {
    const log: string[] = [];
    await executePlan(makePlan(), { sessions: new Map([["local", fakeSession(log)]]) });
    expect(log).toEqual(["set k1=secret-value", "remove k2"]); // unchanged Plan-2 behavior
  });
});
