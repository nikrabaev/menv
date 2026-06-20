import { describe, expect, test } from "bun:test";
import {
  backupsList,
  isSelectable,
  moveSelectable,
  selectedVariable,
  settleIndex,
  sidebarEntries,
  variablesList,
} from "../../src/tui/state/lists.ts";
import { initialState } from "../../src/tui/state/store.tsx";
import { makeRegistry } from "../helpers/fixtures.ts";

describe("sidebarEntries", () => {
  test("vault and consumer sections with headers; placeholder when no consumers", () => {
    const registry = makeRegistry({ consumers: {} });
    const entries = sidebarEntries(registry);
    expect(entries.map((e) => e.kind)).toEqual(["header", "vault", "vault", "header", "empty"]);
  });
});

describe("moveSelectable / settleIndex", () => {
  const registry = makeRegistry();
  const entries = sidebarEntries(registry); // header, local, production, header, api, web

  test("skips headers in both directions", () => {
    expect(moveSelectable(entries, 1, 1, isSelectable)).toBe(2);
    expect(moveSelectable(entries, 2, 1, isSelectable)).toBe(4); // hops the CONSUMERS header
    expect(moveSelectable(entries, 4, -1, isSelectable)).toBe(2);
  });

  test("clamps at the edges", () => {
    expect(moveSelectable(entries, 1, -1, isSelectable)).toBe(1);
    expect(moveSelectable(entries, 5, 1, isSelectable)).toBe(5);
  });

  test("settleIndex moves a header cursor to the nearest selectable row", () => {
    expect(settleIndex(entries, 0, isSelectable)).toBe(1);
    expect(settleIndex(entries, 3, isSelectable)).toBe(4);
  });
});

describe("variables selection", () => {
  test("selectedVariable settles off the group header", () => {
    const registry = makeRegistry();
    registry.variables = {
      X: { groupKey: "db", vaultMapping: {} },
    };
    const state = initialState(registry);
    expect(state.mainIndex.variables).toBe(0); // the "Database" header row
    expect(variablesList(state)[0]?.type).toBe("header");
    expect(selectedVariable(state)).toBe("X");
  });
});

describe("backupsList", () => {
  test("newest first", () => {
    const state = initialState(makeRegistry());
    state.backups = ["2026-01-01T00-00-00", "2026-06-01T00-00-00"];
    expect(backupsList(state)).toEqual(["2026-06-01T00-00-00", "2026-01-01T00-00-00"]);
  });
});
