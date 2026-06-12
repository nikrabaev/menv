import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planGroupAdd, planGroupRemove, planGroupUpdate } from "../../../src/core/ops/group.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

describe("group ops", () => {
  test("add / update", () => {
    const { next } = planGroupAdd(makeRegistry(), { key: "payments", title: "Payments" });
    expect(next.groups.payments).toEqual({ title: "Payments" });
    const { next: n2 } = planGroupUpdate(next, { key: "payments", title: "Billing" });
    expect(n2.groups.payments?.title).toBe("Billing");
  });

  test("duplicate add / unknown update", () => {
    try {
      planGroupAdd(makeRegistry(), { key: "db", title: "x" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
    try {
      planGroupUpdate(makeRegistry(), { key: "ghost", title: "x" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });

  test("remove with members: blockers + forced outcome clears groupKey", () => {
    const r = makeRegistry();
    r.variables.DATABASE_URL = { groupKey: "db", vaultMapping: {} };
    const { next, plan } = planGroupRemove(r, { key: "db" });
    expect(plan.blockers).toEqual([
      { code: "GROUP_IN_USE", message: 'variable "DATABASE_URL" is in group "db"' },
    ]);
    expect(next.groups.db).toBeUndefined();
    expect(next.variables.DATABASE_URL?.groupKey).toBeUndefined();
  });

  test("remove with no members has no blockers", () => {
    expect(planGroupRemove(makeRegistry(), { key: "db" }).plan.blockers).toEqual([]);
  });
});
