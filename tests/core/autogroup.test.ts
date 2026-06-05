import { expect, test } from "bun:test";
import { autoGroupAssignments } from "../../src/core/autogroup.ts";
import type { Variable } from "../../src/core/types.ts";

// Minimal variable fixture — only the fields auto-grouping reads.
const v = (id: string, name: string, group: string | null = null, local = false): Variable => ({
  id, name, description: "", group, secret: false, wiring: [], ...(local ? { local: true } : {}),
});

test("groups 2+ variables sharing a prefix into that prefix", () => {
  const vars = [v("a", "DB_USER"), v("b", "DB_PASSWORD"), v("c", "DB_HOST")];
  expect(autoGroupAssignments(vars)).toEqual([
    { id: "a", group: "DB" },
    { id: "b", group: "DB" },
    { id: "c", group: "DB" },
  ]);
});

test("leaves a variable whose prefix is unique to it ungrouped", () => {
  const vars = [v("a", "DB_USER"), v("b", "DB_PASSWORD"), v("c", "REDIS_URL")];
  const out = autoGroupAssignments(vars);
  expect(out.map((a) => a.id).sort()).toEqual(["a", "b"]);
  expect(out.every((a) => a.group === "DB")).toBe(true);
});

test("ignores names without an underscore", () => {
  const vars = [v("a", "PORT"), v("b", "HOST")];
  expect(autoGroupAssignments(vars)).toEqual([]);
});

test("ignores a leading-underscore name (empty prefix)", () => {
  const vars = [v("a", "_FOO"), v("b", "_BAR")];
  expect(autoGroupAssignments(vars)).toEqual([]);
});

test("by default only touches ungrouped variables, preserving manual groups", () => {
  const vars = [v("a", "DB_USER", "Database"), v("b", "DB_PASSWORD")];
  // Only one *ungrouped* DB var ⇒ nothing qualifies (a is already grouped).
  expect(autoGroupAssignments(vars)).toEqual([]);
});

test("overwrite re-derives groups for every variable, replacing existing ones", () => {
  const vars = [v("a", "DB_USER", "Database"), v("b", "DB_PASSWORD", "Database")];
  expect(autoGroupAssignments(vars, { overwrite: true })).toEqual([
    { id: "a", group: "DB" },
    { id: "b", group: "DB" },
  ]);
});

test("overwrite does not emit no-op reassignments for a var already in the right group", () => {
  const vars = [v("a", "DB_USER", "DB"), v("b", "DB_PASSWORD", "Database")];
  // a already sits in "DB"; only b changes.
  expect(autoGroupAssignments(vars, { overwrite: true })).toEqual([{ id: "b", group: "DB" }]);
});

test("names the group by the longest segment-prefix every member shares", () => {
  const vars = [v("a", "NEXT_PUBLIC_API_URL"), v("b", "NEXT_PUBLIC_SITE_URL")];
  // Both share two whole segments ⇒ the group is the deeper "NEXT_PUBLIC", not "NEXT".
  expect(autoGroupAssignments(vars)).toEqual([
    { id: "a", group: "NEXT_PUBLIC" },
    { id: "b", group: "NEXT_PUBLIC" },
  ]);
});

test("falls back to the shared leading segment when members diverge earlier", () => {
  const vars = [v("a", "NEXT_PUBLIC_API"), v("b", "NEXT_PUBLIC_SITE"), v("c", "NEXT_AUTH_SECRET")];
  // PUBLIC/PUBLIC/AUTH diverge at the second segment ⇒ common prefix is just "NEXT".
  expect(autoGroupAssignments(vars)).toEqual([
    { id: "a", group: "NEXT" },
    { id: "b", group: "NEXT" },
    { id: "c", group: "NEXT" },
  ]);
});

test("computes the common prefix by whole segments, never mid-segment", () => {
  // Character-wise these share "API_KEY", but by segment only "API" is common.
  const vars = [v("a", "API_KEY"), v("b", "API_KEYS")];
  expect(autoGroupAssignments(vars)).toEqual([
    { id: "a", group: "API" },
    { id: "b", group: "API" },
  ]);
});

test("the common prefix can be several segments deep", () => {
  const vars = [v("a", "MY_APP_DB_USER"), v("b", "MY_APP_DB_PASS")];
  expect(autoGroupAssignments(vars)).toEqual([
    { id: "a", group: "MY_APP_DB" },
    { id: "b", group: "MY_APP_DB" },
  ]);
});

test("a base variable and its local sibling count as one distinct name", () => {
  // Same name twice (base + local) is one logical variable ⇒ no group of two.
  const vars = [v("a", "DB_URL"), v("b", "DB_URL", null, true)];
  expect(autoGroupAssignments(vars)).toEqual([]);
  // But add a second distinct DB name and both the base, its local, and the
  // sibling all join the group.
  const withSibling = [...vars, v("c", "DB_HOST")];
  expect(autoGroupAssignments(withSibling).map((x) => x.id).sort()).toEqual(["a", "b", "c"]);
});
