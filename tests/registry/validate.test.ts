import { describe, expect, test } from "bun:test";
import { validateRegistry } from "../../src/registry/validate.ts";

// Minimal valid registry; tests mutate copies of it.
function makeDoc(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    defaults: { vault: "local" },
    vaults: {
      local: { vaultType: "menv-local", vaultConfig: { filename: ".menv/vault.json", encryption: true } },
      production: { vaultType: "menv-local", vaultConfig: { filename: ".menv/vault.production.json", encryption: true } },
    },
    consumers: {
      api: { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env" } },
      web: {
        strategyType: "per-vault",
        strategyConfig: {
          baseDir: "apps/web",
          secretsAsLocalOverrides: true,
          filenames: { local: ".env.development", production: ".env.production" },
        },
      },
    },
    groups: { db: { title: "Database" } },
    globals: {
      COOLIFY_FQDN: {
        values: {
          production: { source: "runtime" },
          local: { source: "static", value: "localhost:3000" },
        },
      },
    },
    variables: {
      DATABASE_URL: {
        groupKey: "db",
        secret: true,
        vaultMapping: {
          local: { api: { key: "k1" }, web: { key: "k1" } },
          production: { api: { key: "k2", disabled: true } },
        },
      },
    },
    compose: { files: ["docker-compose.yml"] },
  };
}

const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe("validateRegistry", () => {
  test("accepts a full valid document", () => {
    const { registry, issues } = validateRegistry(makeDoc());
    expect(issues).toEqual([]);
    expect(registry?.schemaVersion).toBe(2);
  });

  test("optional sections default to empty", () => {
    const doc = makeDoc();
    delete doc.groups;
    delete doc.globals;
    delete doc.variables;
    delete doc.compose;
    const { registry, issues } = validateRegistry(doc);
    expect(issues).toEqual([]);
    expect(registry?.groups).toEqual({});
    expect(registry?.variables).toEqual({});
    expect(registry?.compose).toEqual({ files: [] });
  });

  test("rejects a non-object and wrong schemaVersion", () => {
    expect(validateRegistry("nope").registry).toBeNull();
    const doc = makeDoc();
    doc.schemaVersion = 1;
    expect(paths(validateRegistry(doc).issues)).toContain("schemaVersion");
  });

  test("rejects defaults.vault naming an unknown vault", () => {
    const doc = makeDoc();
    (doc.defaults as Record<string, unknown>).vault = "ghost";
    expect(paths(validateRegistry(doc).issues)).toContain("defaults.vault");
  });

  test("rejects unknown references from variables", () => {
    const doc = makeDoc();
    const vars = doc.variables as Record<string, Record<string, unknown>>;
    vars.DATABASE_URL.groupKey = "ghost-group";
    vars.DATABASE_URL.vaultMapping = {
      "ghost-vault": { api: { key: "k" } },
      local: { "ghost-consumer": { key: "k" } },
    };
    const got = paths(validateRegistry(doc).issues);
    expect(got).toContain("variables.DATABASE_URL.groupKey");
    expect(got).toContain("variables.DATABASE_URL.vaultMapping.ghost-vault");
    expect(got).toContain("variables.DATABASE_URL.vaultMapping.local.ghost-consumer");
  });

  test("rejects per-vault filenames keyed by unknown vaults", () => {
    const doc = makeDoc();
    const web = (doc.consumers as Record<string, Record<string, unknown>>).web;
    (web.strategyConfig as Record<string, unknown>).filenames = { staging: ".env.staging" };
    expect(paths(validateRegistry(doc).issues)).toContain("consumers.web.strategyConfig.filenames.staging");
  });

  test("rejects a static global without a value and an unknown global vault", () => {
    const doc = makeDoc();
    (doc.globals as Record<string, Record<string, unknown>>).COOLIFY_FQDN.values = {
      local: { source: "static" },
      ghost: { source: "runtime" },
    };
    const got = paths(validateRegistry(doc).issues);
    expect(got).toContain("globals.COOLIFY_FQDN.values.local.value");
    expect(got).toContain("globals.COOLIFY_FQDN.values.ghost");
  });

  test("rejects invalid variable names", () => {
    const doc = makeDoc();
    (doc.variables as Record<string, unknown>)["1BAD NAME"] = { vaultMapping: {} };
    expect(paths(validateRegistry(doc).issues)).toContain("variables.1BAD NAME");
  });
});
