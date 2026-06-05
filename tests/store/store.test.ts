import { expect, test } from "bun:test";
import type { RepoModel } from "../../src/core/types.ts";
import { createStore } from "../../src/store/store.ts";

function baseModel(): RepoModel {
  return {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: {},
    recipients: [],
  };
}

const v1 = (store: ReturnType<typeof createStore>) => store.getModel().variables.find((v) => v.id === "v1")!;

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
  store.addVariable({ id: "v2", name: "API_KEY", description: "", group: null, secret: false, wiring: [] });
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
  expect(v1(store).example).toBe("pg://example");
  store.setExample("v1", "");
  expect(v1(store).example).toBeUndefined();
  expect(store.isDirty()).toBe(true);
});

test("setSecret sets the flag explicitly (not a toggle)", () => {
  const store = createStore(baseModel());
  store.setSecret("v1", true);
  expect(v1(store).secret).toBe(true);
  store.setSecret("v1", true); // idempotent, unlike toggleSecret
  expect(v1(store).secret).toBe(true);
  store.setSecret("v1", false);
  expect(v1(store).secret).toBe(false);
});

test("wire adds and removes a consumer", () => {
  const store = createStore(baseModel());
  store.wire("v1", "app:web", true);
  expect(v1(store).wiring).toEqual([{ consumer: "app:api" }, { consumer: "app:web" }]);
  store.wire("v1", "app:web", true); // idempotent
  expect(v1(store).wiring).toEqual([{ consumer: "app:api" }, { consumer: "app:web" }]);
  store.wire("v1", "app:api", false);
  expect(v1(store).wiring).toEqual([{ consumer: "app:web" }]);
});

test("setConsumers replaces the wiring set and de-dupes", () => {
  const store = createStore(baseModel());
  store.setConsumers("v1", ["app:web", "root", "app:web"]);
  expect(v1(store).wiring).toEqual([{ consumer: "app:web" }, { consumer: "root" }]);
  store.setConsumers("v1", []);
  expect(v1(store).wiring).toEqual([]);
});

test("setConsumers preserves the unapplied set for consumers that remain", () => {
  const model = baseModel();
  model.variables[0]!.wiring = [{ consumer: "app:api", unapplied: ["prod"] }];
  const store = createStore(model);
  store.setConsumers("v1", ["app:api", "app:web"]);
  expect(v1(store).wiring).toEqual([{ consumer: "app:api", unapplied: ["prod"] }, { consumer: "app:web" }]);
});

test("setApplied toggles an env in and out of a consumer's unapplied set", () => {
  const store = createStore(baseModel());
  store.setApplied("v1", "app:api", "prod", false);
  expect(v1(store).wiring).toEqual([{ consumer: "app:api", unapplied: ["prod"] }]);
  store.setApplied("v1", "app:api", "prod", false); // idempotent, no duplicate
  expect(v1(store).wiring).toEqual([{ consumer: "app:api", unapplied: ["prod"] }]);
  store.setApplied("v1", "app:api", "prod", true);
  expect(v1(store).wiring).toEqual([{ consumer: "app:api" }]);
});

test("setApplied(false) on an unwired consumer wires it as unapplied", () => {
  const store = createStore(baseModel());
  store.setApplied("v1", "app:web", "prod", false);
  expect(v1(store).wiring).toEqual([{ consumer: "app:api" }, { consumer: "app:web", unapplied: ["prod"] }]);
});

test("setValues writes a value to every listed env in one change", () => {
  const store = createStore(baseModel());
  store.setValue("v1", "dev", "3000");
  let notified = 0;
  store.subscribe(() => notified++);
  store.setValues("v1", ["dev", "staging", "prod"], "8080");
  expect(store.getModel().values.v1).toEqual({ dev: "8080", staging: "8080", prod: "8080" });
  expect(notified).toBe(1); // a single notify, not one per env
});

test("setEnvMode sets the mode and ensures an envFile gate when going per-env", () => {
  const model = baseModel();
  // An app with no envFile yet (not materialized at init).
  model.consumers = [{ kind: "app", id: "app:api", name: "api", path: "apps/api" }];
  const store = createStore(model);
  store.setEnvMode("app:api", "perenv");
  const c = store.getModel().consumers.find((c) => c.id === "app:api")!;
  expect(c.envMode).toBe("perenv");
  expect(c.envFile).toBe(".env"); // gate materialized so generation runs
  store.setEnvMode("app:api", "single");
  expect(store.getModel().consumers.find((c) => c.id === "app:api")!.envMode).toBe("single");
});
