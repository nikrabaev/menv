import { describe, expect, test } from "bun:test";
import { planImportEntries } from "../../../src/core/ops/importOps.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

function seq(): () => string {
  let n = 0;
  return () => `key-${++n}`;
}

describe("planImportEntries", () => {
  test("new names: define (secret heuristic) + wire + set", () => {
    const { result, report } = planImportEntries(makeRegistry(), {
      entries: [
        { key: "API_TOKEN", value: "t" },
        { key: "PORT", value: "3000" },
      ],
      consumer: "api",
      vault: "local",
      currentValues: new Map(),
      force: false,
      newKey: seq(),
    });
    expect(result.next.variables.API_TOKEN?.secret).toBe(true); // name heuristic
    expect(result.next.variables.PORT?.secret).toBeUndefined();
    expect(result.next.variables.PORT?.vaultMapping.local?.api?.key).toBe("key-2");
    expect(result.plan.vaults).toEqual([
      { vault: "local", action: "set", key: "key-1", value: "t" },
      { vault: "local", action: "set", key: "key-2", value: "3000" },
    ]);
    expect(report.defined.sort()).toEqual(["API_TOKEN", "PORT"]);
    expect(report.wired.sort()).toEqual(["API_TOKEN", "PORT"]);
  });

  test("existing wired entry: updates in place; shared-key conflict blocks and splits", () => {
    const r = makeRegistry();
    r.variables.DATABASE_URL = {
      vaultMapping: { local: { api: { key: "shared" }, web: { key: "shared" } } },
    };
    const { result, report } = planImportEntries(r, {
      entries: [{ key: "DATABASE_URL", value: "postgres://api-own" }],
      consumer: "api",
      vault: "local",
      currentValues: new Map([["shared", "postgres://both"]]),
      force: false,
      newKey: seq(),
    });
    expect(result.plan.blockers.some((b) => b.code === "SHARED_KEY_CONFLICT")).toBe(true);
    // forced outcome: api splits onto its own key; web keeps the shared one
    expect(result.next.variables.DATABASE_URL?.vaultMapping.local?.api?.key).toBe("key-1");
    expect(result.next.variables.DATABASE_URL?.vaultMapping.local?.web?.key).toBe("shared");
    expect(result.plan.vaults).toEqual([
      { vault: "local", action: "set", key: "key-1", value: "postgres://api-own" },
    ]);
    expect(report.updated).toEqual(["DATABASE_URL"]);
  });

  test("same value on a shared key is no conflict; invalid names are skipped", () => {
    const r = makeRegistry();
    r.variables.X = { vaultMapping: { local: { api: { key: "k" }, web: { key: "k" } } } };
    const { result, report } = planImportEntries(r, {
      entries: [
        { key: "X", value: "same" },
        { key: "1bad", value: "v" },
      ],
      consumer: "api",
      vault: "local",
      currentValues: new Map([["k", "same"]]),
      force: false,
      newKey: seq(),
    });
    expect(result.plan.blockers).toEqual([]);
    expect(result.plan.vaults).toEqual([{ vault: "local", action: "set", key: "k", value: "same" }]);
    expect(report.skipped).toEqual([{ key: "1bad", reason: "invalid variable name" }]);
  });
});
