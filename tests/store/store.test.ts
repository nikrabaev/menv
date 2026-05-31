import { expect, test } from "bun:test";
import { createStore } from "../../src/store/store.ts";
import type { RepoModel } from "../../src/core/types.ts";

function baseModel(): RepoModel {
  return {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: { dev: ".env" } }],
    values: {},
    recipients: [],
  };
}

test("setValue marks dirty and notifies", () => {
  const store = createStore(baseModel());
  let notified = 0;
  store.subscribe(() => notified++);
  expect(store.isDirty()).toBe(false);
  store.setValue("v1", "dev", "3000");
  expect(store.getModel().values.v1.dev).toBe("3000");
  expect(store.isDirty()).toBe(true);
  expect(notified).toBe(1);
});

test("addVariable and toggleSecret mutate the model", () => {
  const store = createStore(baseModel());
  store.addVariable({ id: "v2", name: "API_KEY", tier: "global", description: "", group: null, secret: false, consumers: [] });
  expect(store.getModel().variables.some((v) => v.name === "API_KEY")).toBe(true);
  store.toggleSecret("v2");
  expect(store.getModel().variables.find((v) => v.id === "v2")!.secret).toBe(true);
});

test("markClean resets the dirty flag", () => {
  const store = createStore(baseModel());
  store.setValue("v1", "dev", "x");
  store.markClean();
  expect(store.isDirty()).toBe(false);
});

test("setExample sets and clears the example", () => {
  const store = createStore(baseModel());
  store.setExample("v1", "pg://example");
  expect(store.getModel().variables.find((v) => v.id === "v1")!.example).toBe("pg://example");
  store.setExample("v1", "");
  expect(store.getModel().variables.find((v) => v.id === "v1")!.example).toBeUndefined();
  expect(store.isDirty()).toBe(true);
});
