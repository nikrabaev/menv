import { expect, test, describe } from "bun:test";
import { resolveVar, resolveConsumer, defaultEnv, readValue } from "../../src/cli/context.ts";
import type { RepoModel } from "../../src/core/types.ts";

function model(): RepoModel {
  return {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    variables: [
      { id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] },
      { id: "var:NODE_ENV", name: "NODE_ENV", description: "", group: null, secret: false, consumers: ["app:api"] },
      { id: "var:NODE_ENV#2", name: "NODE_ENV", description: "", group: null, secret: false, consumers: ["app:web"] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api" },
      { kind: "app", id: "app:web", name: "web", path: "apps/web" },
      { kind: "app", id: "root", name: "root", path: ".", envFile: ".env" },
    ],
    values: {},
    recipients: [],
  };
}

describe("resolveConsumer", () => {
  test("resolves by id, by name, and the root target", () => {
    expect(resolveConsumer(model(), "app:api")).toBe("app:api");
    expect(resolveConsumer(model(), "web")).toBe("app:web");
    expect(resolveConsumer(model(), "root")).toBe("root");
  });
  test("throws on an unknown scope", () => {
    expect(() => resolveConsumer(model(), "nope")).toThrow(/unknown scope/);
  });
});

describe("resolveVar", () => {
  test("resolves a unique name", () => {
    expect(resolveVar(model(), "PORT").id).toBe("var:PORT");
  });
  test("disambiguates a repeated name by scope", () => {
    expect(resolveVar(model(), "NODE_ENV", { scope: "api" }).id).toBe("var:NODE_ENV");
    expect(resolveVar(model(), "NODE_ENV", { scope: "web" }).id).toBe("var:NODE_ENV#2");
  });
  test("throws when a repeated name is ambiguous", () => {
    expect(() => resolveVar(model(), "NODE_ENV")).toThrow(/ambiguous/);
  });
  test("throws when the name is unknown", () => {
    expect(() => resolveVar(model(), "MISSING")).toThrow(/no variable named/);
  });
});

describe("defaultEnv", () => {
  test("falls back to the default environment", () => {
    expect(defaultEnv(model())).toBe("dev");
  });
  test("returns a valid requested environment", () => {
    expect(defaultEnv(model(), "prod")).toBe("prod");
  });
  test("throws on an unknown environment", () => {
    expect(() => defaultEnv(model(), "nope")).toThrow(/unknown environment/);
  });
});

describe("readValue", () => {
  test("returns the positional arg verbatim when provided", async () => {
    expect(await readValue("hello", "Value:")).toBe("hello");
    expect(await readValue("", "Value:")).toBe(""); // an explicit empty arg is honored
  });
});
