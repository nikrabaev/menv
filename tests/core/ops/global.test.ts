import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planGlobalDefine, planGlobalRemove, planGlobalUpdate } from "../../../src/core/ops/global.ts";
import type { ValueRecord } from "../../../src/core/refs.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

function withGlobal() {
  const r = makeRegistry();
  r.globals.FQDN = {
    values: {
      production: { source: "runtime" },
      local: { source: "static", value: "localhost:3000" },
    },
  };
  return r;
}

describe("planGlobalDefine / planGlobalUpdate", () => {
  test("define creates per-vault entries; redefining one is an error", () => {
    const { next } = planGlobalDefine(makeRegistry(), { name: "FQDN", vault: "production", source: "runtime" });
    expect(next.globals.FQDN?.values.production).toEqual({ source: "runtime" });
    const { next: n2 } = planGlobalDefine(next, {
      name: "FQDN",
      vault: "local",
      source: "static",
      value: "localhost:3000",
    });
    expect(n2.globals.FQDN?.values.local).toEqual({ source: "static", value: "localhost:3000" });
    try {
      planGlobalDefine(n2, { name: "FQDN", vault: "local", source: "runtime" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).message).toContain("global update");
    }
  });

  test("static requires a value; update requires an existing entry", () => {
    expect(() => planGlobalDefine(makeRegistry(), { name: "X", vault: "local", source: "static" })).toThrow(
      "static global needs --value",
    );
    try {
      planGlobalUpdate(makeRegistry(), { name: "X", vault: "local", source: "runtime" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });
});

describe("planGlobalRemove", () => {
  const refRecord: ValueRecord = { variable: "URL", vault: "production", consumer: "api", raw: "https://${FQDN}/x" };

  test("dependent references become blockers", () => {
    const { plan } = planGlobalRemove(withGlobal(), {
      name: "FQDN",
      records: [refRecord],
      unverified: [],
    });
    expect(plan.blockers.some((b) => b.code === "DEPENDENT_REFERENCE" && b.message.includes("URL"))).toBe(true);
  });

  test("a same-named wired variable shadows the global — no blocker", () => {
    const r = withGlobal();
    r.variables.FQDN = { vaultMapping: { production: { api: { key: "k" } } } };
    const { plan } = planGlobalRemove(r, { name: "FQDN", records: [refRecord], unverified: [] });
    expect(plan.blockers.filter((b) => b.code === "DEPENDENT_REFERENCE")).toEqual([]);
  });

  test("--vault removes one entry; whole global removed when values empty out", () => {
    const one = planGlobalRemove(withGlobal(), { name: "FQDN", vault: "local", records: [], unverified: [] });
    expect(one.next.globals.FQDN?.values.local).toBeUndefined();
    expect(one.next.globals.FQDN?.values.production).toBeDefined();
    const all = planGlobalRemove(withGlobal(), { name: "FQDN", records: [], unverified: [] });
    expect(all.next.globals.FQDN).toBeUndefined();
  });

  test("unverified vaults gate with a blocker", () => {
    const { plan } = planGlobalRemove(withGlobal(), { name: "FQDN", records: [], unverified: ["production"] });
    expect(plan.blockers.some((b) => b.code === "UNVERIFIED_REFERENCES")).toBe(true);
  });
});
