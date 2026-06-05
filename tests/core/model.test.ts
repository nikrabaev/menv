import { expect, test } from "bun:test";
import { consumerIdsOf, isApplied, isAppliedAnywhere, isWired, resolveValue, varsForConsumer, wiringFor } from "../../src/core/model.ts";
import type { RepoModel } from "../../src/core/types.ts";

const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "", group: "DB", secret: true, wiring: [{ consumer: "app:api" }] },
    { id: "v2", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api", unapplied: ["prod"] }] },
    { id: "v3", name: "OTHER", description: "", group: null, secret: false, wiring: [{ consumer: "app:web" }] },
  ],
  consumers: [],
  values: { v1: { dev: "pg://x" }, v2: { dev: "3000" } },
  recipients: [],
};

const byId = (id: string) => model.variables.find((v) => v.id === id)!;

test("varsForConsumer returns only wired vars", () => {
  const names = varsForConsumer(model, "app:api").map((v) => v.name).sort();
  expect(names).toEqual(["DATABASE_URL", "PORT"]);
});

test("resolveValue returns the env value or empty string", () => {
  expect(resolveValue(model, "v1", "dev")).toBe("pg://x");
  expect(resolveValue(model, "v1", "prod")).toBe("");
});

test("consumerIdsOf lists the wired consumers", () => {
  expect(consumerIdsOf(byId("v1"))).toEqual(["app:api"]);
});

test("isWired reflects the wiring list", () => {
  expect(isWired(byId("v1"), "app:api")).toBe(true);
  expect(isWired(byId("v1"), "app:web")).toBe(false);
});

test("wiringFor returns the matching entry or undefined", () => {
  expect(wiringFor(byId("v2"), "app:api")?.unapplied).toEqual(["prod"]);
  expect(wiringFor(byId("v2"), "app:web")).toBeUndefined();
});

test("isAppliedAnywhere is true if the var is applied for at least one wired consumer", () => {
  // v2 is applied in dev (for app:api) ⇒ applied somewhere in dev.
  expect(isAppliedAnywhere(byId("v2"), "dev")).toBe(true);
  // v2 is unapplied in prod for its only consumer ⇒ not applied anywhere in prod.
  expect(isAppliedAnywhere(byId("v2"), "prod")).toBe(false);
  // an unwired var is applied nowhere.
  expect(isAppliedAnywhere({ ...byId("v1"), wiring: [] }, "dev")).toBe(false);
});

test("isApplied is true unless the env is in that consumer's unapplied set", () => {
  // v2 is wired to app:api but unapplied in prod.
  expect(isApplied(byId("v2"), "app:api", "dev")).toBe(true);
  expect(isApplied(byId("v2"), "app:api", "prod")).toBe(false);
  // v1 has no unapplied set ⇒ applied everywhere it is wired.
  expect(isApplied(byId("v1"), "app:api", "prod")).toBe(true);
  // not wired ⇒ not applied.
  expect(isApplied(byId("v1"), "app:web", "dev")).toBe(false);
});
