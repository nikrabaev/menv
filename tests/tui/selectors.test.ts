import { describe, expect, test } from "bun:test";
import type { VariableDef } from "../../src/registry/types.ts";
import {
  cardWindow,
  cellGlyph,
  cellState,
  humanVarRows,
  marqueeSlice,
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

describe("humanVarRows", () => {
  test("groups by value, most-shared first, alphabetical within a group", () => {
    const d = def({
      local: {
        consumer_1: { key: "k1" },
        consumer_2: { key: "k2" },
        consumer_3: { key: "k3" },
        consumer_4: { key: "k4" },
        consumer_5: { key: "k5" },
        consumer_6: { key: "k6" },
      },
    });
    const values = { k1: "value_A", k2: "value_B", k3: "value_A", k4: "value_A", k5: "value_C", k6: "value_B" };
    const rows = humanVarRows(d, "local", values);
    expect(rows.map((r) => `${r.consumer};${r.value}`)).toEqual([
      "consumer_1;value_A",
      "consumer_3;value_A",
      "consumer_4;value_A",
      "consumer_2;value_B",
      "consumer_6;value_B",
      "consumer_5;value_C",
    ]);
  });

  test("equal counts break ties by value string; missing-value group goes last", () => {
    const d = def({ local: { a: { key: "ka" }, b: { key: "kb" }, c: { key: "kc" } } });
    const rows = humanVarRows(d, "local", { ka: "zeta", kb: "alpha" }); // kc has no value
    expect(rows.map((r) => `${r.consumer};${r.value ?? "∅"}`)).toEqual(["b;alpha", "a;zeta", "c;∅"]);
    expect(rows[2]?.hasValue).toBe(false);
  });

  test("carries the disabled flag per consumer", () => {
    const d = def({ local: { a: { key: "k", disabled: true }, b: { key: "k" } } });
    const rows = humanVarRows(d, "local", { k: "v" });
    expect(rows.find((r) => r.consumer === "a")?.disabled).toBe(true);
    expect(rows.find((r) => r.consumer === "b")?.disabled).toBe(false);
  });

  test("locked vault: values unknown, rows fall back to alphabetical", () => {
    const d = def({ local: { web: { key: "kw" }, api: { key: "ka" } } });
    const rows = humanVarRows(d, "local", null);
    expect(rows.map((r) => r.consumer)).toEqual(["api", "web"]);
    expect(rows.every((r) => r.value === undefined && r.hasValue === undefined)).toBe(true);
  });
});

describe("marqueeSlice", () => {
  test("step 0 shows the head; advancing scrolls; clamps at the end", () => {
    expect(marqueeSlice("hello world", 5, 0)).toBe("hello");
    expect(marqueeSlice("hello world", 5, 2)).toBe("llo w");
    expect(marqueeSlice("hello world", 5, 100)).toBe("world"); // never loops past the end
  });

  test("text shorter than the window is returned whole", () => {
    expect(marqueeSlice("hi", 5, 3)).toBe("hi");
  });
});

describe("cardWindow", () => {
  test("everything fits → no scrolling", () => {
    expect(cardWindow([2, 2, 2], 0, 10)).toEqual({ offset: 0, count: 3, above: 0, below: 0 });
  });

  test("keeps the selected card visible, filling the line budget", () => {
    expect(cardWindow([2, 2, 2, 2, 2], 0, 6)).toEqual({ offset: 0, count: 3, above: 0, below: 2 });
    expect(cardWindow([2, 2, 2, 2, 2], 4, 6)).toEqual({ offset: 2, count: 3, above: 2, below: 0 });
    expect(cardWindow([2, 2, 2, 2, 2], 2, 6)).toEqual({ offset: 1, count: 3, above: 1, below: 1 });
  });

  test("a single oversized card is still shown (clipped)", () => {
    expect(cardWindow([10, 2, 2], 0, 6)).toEqual({ offset: 0, count: 1, above: 0, below: 2 });
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
