import { expect, test, describe } from "bun:test";
import { groupedRows, orderedVariables, groupStarts, jumpGroup, groupNames } from "../../src/ui/grouping.ts";
import type { Variable } from "../../src/core/types.ts";

const mk = (name: string, group: string | null): Variable => ({
  id: `var:${name}`, name, description: "", group, secret: false, consumers: [],
});

// A deliberately unordered set spanning two groups and some ungrouped vars.
const vars: Variable[] = [
  mk("ZED", "DB"),
  mk("APPLE", null),
  mk("MID", "Auth"),
  mk("BANANA", null),
  mk("ALPHA", "DB"),
];

describe("groupNames", () => {
  test("returns distinct non-null groups, sorted", () => {
    expect(groupNames(vars)).toEqual(["Auth", "DB"]);
  });
  test("is empty when nothing is grouped", () => {
    expect(groupNames([mk("A", null), mk("B", null)])).toEqual([]);
  });
});

describe("groupedRows (flat)", () => {
  test("ungrouped flag yields a single name-sorted run with no headers", () => {
    const rows = groupedRows(vars, false);
    expect(rows.every((r) => r.kind === "var")).toBe(true);
    expect(rows.map((r) => (r.kind === "var" ? r.variable.name : ""))).toEqual([
      "ALPHA", "APPLE", "BANANA", "MID", "ZED",
    ]);
    // index counts var rows in display order
    expect(rows.map((r) => (r.kind === "var" ? r.index : -1))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("groupedRows (grouped)", () => {
  const rows = groupedRows(vars, true);
  const labels = rows.map((r) => (r.kind === "header" ? `#${r.label}` : r.variable.name));

  test("ungrouped come first under a muted Ungrouped header, then groups alphabetically", () => {
    expect(labels).toEqual([
      "#Ungrouped", "APPLE", "BANANA",
      "#Auth", "MID",
      "#DB", "ALPHA", "ZED",
    ]);
  });

  test("only the Ungrouped header is muted", () => {
    const headers = rows.filter((r) => r.kind === "header") as Extract<typeof rows[number], { kind: "header" }>[];
    expect(headers.find((h) => h.label === "Ungrouped")!.muted).toBe(true);
    expect(headers.find((h) => h.label === "DB")!.muted).toBe(false);
    expect(headers.find((h) => h.label === "Auth")!.muted).toBe(false);
  });

  test("var-row indices are sequential across buckets", () => {
    const varRows = rows.filter((r) => r.kind === "var");
    expect(varRows.map((r) => (r as { index: number }).index)).toEqual([0, 1, 2, 3, 4]);
  });

  test("omits the Ungrouped header when every variable is grouped", () => {
    const allGrouped = groupedRows([mk("X", "DB"), mk("Y", "Auth")], true);
    expect(allGrouped.some((r) => r.kind === "header" && r.label === "Ungrouped")).toBe(false);
  });
});

describe("orderedVariables", () => {
  test("matches the var rows of groupedRows", () => {
    expect(orderedVariables(vars, true).map((v) => v.name)).toEqual([
      "APPLE", "BANANA", "MID", "ALPHA", "ZED",
    ]);
  });
});

describe("groupStarts", () => {
  test("marks the first variable index of each bucket when grouped", () => {
    // Ungrouped: 0..1, Auth: 2, DB: 3..4  → starts at 0, 2, 3
    expect(groupStarts(vars, true)).toEqual([0, 2, 3]);
  });
  test("is a single bucket at 0 when flat", () => {
    expect(groupStarts(vars, false)).toEqual([0]);
  });
});

describe("jumpGroup", () => {
  const starts = [0, 2, 3]; // from `vars` grouped

  test("next moves to the following bucket's first variable", () => {
    expect(jumpGroup(starts, 0, 1)).toBe(2); // within Ungrouped -> Auth
    expect(jumpGroup(starts, 1, 1)).toBe(2);
    expect(jumpGroup(starts, 2, 1)).toBe(3); // Auth -> DB
  });

  test("next at the last bucket stays put", () => {
    expect(jumpGroup(starts, 3, 1)).toBe(3);
    expect(jumpGroup(starts, 4, 1)).toBe(4);
  });

  test("prev from mid-bucket snaps to the current bucket's start first", () => {
    expect(jumpGroup(starts, 4, -1)).toBe(3); // DB second item -> DB start
  });

  test("prev from a bucket start moves to the previous bucket", () => {
    expect(jumpGroup(starts, 3, -1)).toBe(2); // DB start -> Auth start
    expect(jumpGroup(starts, 2, -1)).toBe(0); // Auth start -> Ungrouped start
  });

  test("prev at the first bucket stays put", () => {
    expect(jumpGroup(starts, 0, -1)).toBe(0);
  });
});
