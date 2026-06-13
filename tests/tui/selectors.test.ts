import { describe, expect, test } from "bun:test";
import type { VariableDef } from "../../src/registry/types.ts";
import {
  cellGlyph,
  cellState,
  maskValue,
  matches,
  truncate,
  variableCount,
  variableRows,
  vaultBadgeText,
  wiringRows,
} from "../../src/tui/state/selectors.ts";
import { makeRegistry } from "../helpers/fixtures.ts";

const def = (mapping: VariableDef["vaultMapping"], secret = false): VariableDef => ({
  ...(secret ? { secret: true } : {}),
  vaultMapping: mapping,
});

describe("cellState / cellGlyph", () => {
  const d = def({
    local: {
      api: { key: "k1" },
      web: { key: "k1" },
      worker: { key: "k2", disabled: true },
    },
  });

  test("unwired", () => {
    const cell = cellState(d, "local", "nope", { k1: "v" });
    expect(cell.wired).toBe(false);
    expect(cellGlyph(cell).char).toBe("·");
  });

  test("wired with value", () => {
    const cell = cellState(d, "production", "api", {});
    expect(cell.wired).toBe(false); // not wired in that vault
    const local = cellState(d, "local", "api", { k1: "v" });
    expect(local).toMatchObject({ wired: true, shared: true, hasValue: true, disabled: false });
    expect(cellGlyph(local).char).toBe("◆"); // shared
  });

  test("wired, missing value", () => {
    const cell = cellState(d, "local", "worker", {});
    expect(cell.hasValue).toBe(false);
    expect(cell.disabled).toBe(true);
    expect(cellGlyph(cell).char).toBe("#"); // disabled wins the glyph
  });

  test("missing value renders the hollow marker", () => {
    const solo = def({ local: { api: { key: "k9" } } });
    const cell = cellState(solo, "local", "api", {});
    expect(cellGlyph(cell).char).toBe("◌");
  });

  test("locked vault → unknown value state", () => {
    const cell = cellState(d, "local", "api", null);
    expect(cell.hasValue).toBeUndefined();
  });
});

describe("variableRows", () => {
  const registry = makeRegistry();
  registry.groups = { db: { title: "Database" }, zz: { title: "Aardvark" } };
  registry.variables = {
    B_VAR: { groupKey: "db", vaultMapping: { local: { api: { key: "b" } } } },
    A_VAR: { vaultMapping: { local: { api: { key: "a" } } } },
    C_VAR: { groupKey: "zz", vaultMapping: { local: { web: { key: "c" } } } },
    GONE_GROUP: { groupKey: "removed", vaultMapping: {} },
  };

  test("groups sort by title, ungrouped last, headers interleaved", () => {
    const rows = variableRows(registry, { vault: "local", filter: "" });
    const labels = rows.map((r) => (r.type === "header" ? `#${r.title}` : r.name));
    expect(labels).toEqual(["#Aardvark", "C_VAR", "#Database", "B_VAR", "#removed", "GONE_GROUP", "#(ungrouped)", "A_VAR"]);
    expect(variableCount(rows)).toBe(4);
  });

  test("consumer scope keeps only variables wired to that consumer (any vault)", () => {
    const rows = variableRows(registry, { vault: "local", consumer: "web", filter: "" });
    expect(rows.filter((r) => r.type === "var").map((r) => (r.type === "var" ? r.name : ""))).toEqual(["C_VAR"]);
  });

  test("filter is smart-case", () => {
    expect(matches("a_v", "A_VAR")).toBe(true); // lowercase query → insensitive
    expect(matches("A_V", "A_VAR")).toBe(true);
    expect(matches("A_V", "a_var")).toBe(false); // mixed-case query → sensitive
    const rows = variableRows(registry, { vault: "local", filter: "c_" });
    expect(variableCount(rows)).toBe(1);
  });
});

describe("wiringRows", () => {
  test("sorted vault then consumer, with per-vault value knowledge", () => {
    const d = def({
      production: { api: { key: "p1" } },
      local: { web: { key: "l1" }, api: { key: "l1" } },
    });
    const rows = wiringRows(d, { local: { l1: "x" }, production: null });
    expect(rows.map((r) => `${r.vault}/${r.consumer}`)).toEqual(["local/api", "local/web", "production/api"]);
    expect(rows[0]?.cell.shared).toBe(true);
    expect(rows[2]?.cell.hasValue).toBeUndefined(); // locked production
  });
});

describe("badges & text utils", () => {
  test("vault badge text", () => {
    // Lock state only — encryption is no longer surfaced. Locked vaults are
    // marked with ⚿; unlocked vaults carry no lock glyph. `*` flags the default.
    expect(vaultBadgeText({ unlocked: false, isDefault: false })).toBe("⚿");
    expect(vaultBadgeText({ unlocked: false, isDefault: true })).toBe("⚿ *");
    expect(vaultBadgeText({ unlocked: true, isDefault: true })).toBe("*");
    expect(vaultBadgeText({ unlocked: true, isDefault: false })).toBe("");
  });

  test("truncate and maskValue", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("ab", 4)).toBe("ab");
    expect(maskValue(true, "topsecret")).toBe("***");
    expect(maskValue(false, "plain")).toBe("plain");
    expect(maskValue(false, undefined)).toBe("∅");
  });
});
