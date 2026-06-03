import { expect, test, describe } from "bun:test";
import { modelToToml, tomlToModelParts } from "../../src/io/persist.ts";
import type { RepoModel } from "../../src/core/types.ts";

const model: RepoModel = {
  root: "/repo",
  environments: [
    { id: "dev", isDefault: true },
    { id: "prod", isDefault: false },
  ],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "db", group: "DB", secret: true, consumers: ["app:api"] },
    { id: "v2", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api", "root"] },
  ],
  consumers: [
    { kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env", envMode: "single" },
    { kind: "app", id: "root", name: "root", path: ".", envFile: ".env", envMode: "perenv" },
  ],
  values: {},
  recipients: ["age1example"],
};

describe("persist", () => {
  test("round-trips config + manifest through TOML (including the root target)", () => {
    const { config, manifest } = modelToToml(model);
    const parts = tomlToModelParts(config, manifest);
    expect(parts.environments).toEqual(model.environments);
    expect(parts.recipients).toEqual(model.recipients);
    expect(parts.variables).toEqual(model.variables);
    expect(parts.consumers).toEqual(model.consumers);
  });

  test("parses a legacy manifest that still carries tier/owner_app, dropping them", () => {
    const config = `environments = ["dev"]\ndefault_environment = "dev"\nrecipients = []\n`;
    const manifest = [
      "[[variables]]",
      'id = "var:OLD"',
      'name = "OLD"',
      'tier = "global"',
      'owner_app = "app:api"',
      'description = ""',
      'group = ""',
      "secret = false",
      'consumers = ["app:api"]',
      'example = ""',
      "",
    ].join("\n");
    const parts = tomlToModelParts(config, manifest);
    expect(parts.variables).toEqual([
      { id: "var:OLD", name: "OLD", description: "", group: null, secret: false, consumers: ["app:api"], example: undefined },
    ]);
    // The parsed shape has no tier/ownerApp keys.
    expect("tier" in parts.variables[0]!).toBe(false);
    expect("ownerApp" in parts.variables[0]!).toBe(false);
  });

  test("an app block without env_mode defaults to single", () => {
    const config = [
      'environments = ["dev"]',
      'default_environment = "dev"',
      "recipients = []",
      "[[apps]]",
      'id = "app:api"',
      'name = "api"',
      'path = "apps/api"',
      'env_file = ".env"',
      "",
    ].join("\n");
    const parts = tomlToModelParts(config, "variables = []\n");
    expect(parts.consumers[0]!.envMode).toBe("single");
  });
});

test("round-trips the 1password key_backend config", () => {
  const m: RepoModel = { ...model, keyBackend: { kind: "1password", opRef: "op://Dev/itm/password" } };
  const { config, manifest } = modelToToml(m);
  expect(tomlToModelParts(config, manifest).keyBackend).toEqual({ kind: "1password", opRef: "op://Dev/itm/password" });
});

test("a config without key_backend defaults to keychain", () => {
  const config = `environments = ["dev"]\ndefault_environment = "dev"\nrecipients = []\n`;
  expect(tomlToModelParts(config, `variables = []\n`).keyBackend).toEqual({ kind: "keychain" });
});

test("round-trips the local-override flag", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:web"] },
      { id: "var:PORT.local", name: "PORT", description: "", group: null, secret: false, consumers: ["app:web"], local: true },
    ],
    consumers: [{ kind: "app", id: "app:web", name: "web", path: "apps/web", envFile: ".env" }],
    values: {},
    recipients: [],
  };
  const { config, manifest } = modelToToml(m);
  const parts = tomlToModelParts(config, manifest);
  expect(parts.variables[0]!.local).toBeUndefined();
  expect(parts.variables[1]!.local).toBe(true);
});

test("round-trips the optional example value", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:REDIS_URL", name: "REDIS_URL", description: "", group: null, secret: false, consumers: ["app:api"], example: "redis://localhost:6379" },
      { id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] },
    ],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: {},
    recipients: [],
  };
  const { config, manifest } = modelToToml(m);
  const parts = tomlToModelParts(config, manifest);
  expect(parts.variables[0]!.example).toBe("redis://localhost:6379");
  expect(parts.variables[1]!.example).toBeUndefined();
});
