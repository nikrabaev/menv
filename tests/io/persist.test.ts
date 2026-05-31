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
    { id: "v1", name: "DATABASE_URL", tier: "global", description: "db", group: "DB", secret: true, consumers: ["app:api"] },
    { id: "v2", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
  ],
  consumers: [
    { kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" },
    { kind: "service", id: "svc:pg", name: "postgres", composeFile: "docker-compose.yml", inject: "env_file", envFileRef: "apps/api/.env" },
  ],
  values: {},
  recipients: ["age1example"],
};

describe("persist", () => {
  test("round-trips config + manifest through TOML", () => {
    const { config, manifest } = modelToToml(model);
    const parts = tomlToModelParts(config, manifest);
    expect(parts.environments).toEqual(model.environments);
    expect(parts.recipients).toEqual(model.recipients);
    expect(parts.variables).toEqual(model.variables);
    expect(parts.consumers).toEqual(model.consumers);
  });
});

test("round-trips the optional example value", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:REDIS_URL", name: "REDIS_URL", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"], example: "redis://localhost:6379" },
      { id: "var:PORT", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
    ],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: {},
    recipients: [],
  };
  const { config, manifest } = modelToToml(m);
  const parts = tomlToModelParts(config, manifest);
  expect(parts.variables[0].example).toBe("redis://localhost:6379");
  expect(parts.variables[1].example).toBeUndefined();
});
