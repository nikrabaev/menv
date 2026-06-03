import { expect, test } from "bun:test";
import type { RepoModel } from "../../src/core/types.ts";
import { createStore } from "../../src/store/store.ts";
import { applyEdit, editInitial, editLabel } from "../../src/ui/editTarget.ts";

function model(): RepoModel {
  return {
    root: "/r", environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "PORT", description: "d", group: "G", secret: false, consumers: [], example: "ex" }],
    consumers: [], values: { v1: { dev: "3000" } }, recipients: [],
  };
}

test("editLabel describes the target with a capitalized label", () => {
  expect(editLabel({ kind: "value", env: "dev" })).toBe("Value · dev");
  expect(editLabel({ kind: "description" })).toBe("Description");
  expect(editLabel({ kind: "example" })).toBe("Example");
  expect(editLabel({ kind: "group" })).toBe("Group");
});

test("editInitial reads the current field value", () => {
  const m = model();
  const v = m.variables[0]!;
  expect(editInitial(m, v, { kind: "value", env: "dev" })).toBe("3000");
  expect(editInitial(m, v, { kind: "description" })).toBe("d");
  expect(editInitial(m, v, { kind: "example" })).toBe("ex");
  expect(editInitial(m, v, { kind: "group" })).toBe("G");
});

test("applyEdit dispatches to the matching store method", () => {
  const store = createStore(model());
  applyEdit(store, "v1", { kind: "value", env: "dev" }, "4000");
  expect(store.getModel().values.v1!.dev).toBe("4000");
  applyEdit(store, "v1", { kind: "description" }, "new desc");
  expect(store.getModel().variables[0]!.description).toBe("new desc");
  applyEdit(store, "v1", { kind: "example" }, "newex");
  expect(store.getModel().variables[0]!.example).toBe("newex");
  applyEdit(store, "v1", { kind: "group" }, "  "); // blank → null
  expect(store.getModel().variables[0]!.group).toBeNull();
});
