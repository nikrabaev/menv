import { expect, test, describe } from "bun:test";
import { buildScopes, varsForScope, stepScope, isSelectable } from "../../src/ui/scopes.ts";
import type { RepoModel } from "../../src/core/types.ts";

function model(): RepoModel {
  return {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "v1", name: "DATABASE_URL", tier: "global", description: "", group: "DB", secret: true, consumers: ["app:api"] },
      { id: "v2", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
      { id: "v3", name: "WEB_FLAG", tier: "local", ownerApp: "app:web", description: "", group: null, secret: false, consumers: ["app:web"] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} },
      { kind: "app", id: "app:web", name: "web", path: "apps/web", envFiles: {} },
      { kind: "service", id: "svc:pg", name: "postgres", composeFile: "docker-compose.yml", inject: "env_file" },
    ],
    values: {},
    recipients: [],
  };
}

describe("buildScopes", () => {
  test("starts with All, Global, then Root", () => {
    const s = buildScopes(model());
    expect(s[0]).toEqual({ id: "all", label: "All", kind: "all" });
    expect(s[1]).toEqual({ id: "global", label: "Global", kind: "global" });
    expect(s[2]).toEqual({ id: "root", label: "Root", kind: "root" });
  });

  test("emits section headers followed by their members", () => {
    const labels = buildScopes(model()).map((x) => x.label);
    // postgres has no wired variables, so SERVICES section is suppressed
    expect(labels).toEqual(["All", "Global", "Root", "APPS", "api", "web", "GROUPS", "DB"]);
    expect(buildScopes(model()).find((x) => x.label === "APPS")!.kind).toBe("header");
  });

  test("omits a section header when it has no members", () => {
    const m = model();
    m.consumers = m.consumers.filter((c) => c.kind === "app"); // drop the service
    const labels = buildScopes(m).map((x) => x.label);
    expect(labels).toContain("APPS");
    expect(labels).not.toContain("SERVICES");
  });

  test("omits apps/services that have no wired variables", () => {
    const m = model();
    // wire a variable to postgres so it appears, verify it does
    m.variables[0]!.consumers = [...m.variables[0]!.consumers, "svc:pg"];
    expect(buildScopes(m).map((x) => x.label)).toContain("postgres");
    // remove the wire — postgres should disappear again
    m.variables[0]!.consumers = m.variables[0]!.consumers.filter((c) => c !== "svc:pg");
    expect(buildScopes(m).map((x) => x.label)).not.toContain("postgres");
  });
});

describe("varsForScope", () => {
  test("all returns every variable", () => {
    expect(varsForScope(model(), "all").map((v) => v.name).sort()).toEqual(["DATABASE_URL", "PORT", "WEB_FLAG"]);
  });
  test("global returns only global-tier variables", () => {
    expect(varsForScope(model(), "global").map((v) => v.name)).toEqual(["DATABASE_URL"]);
  });
  test("root returns only global-tier variables", () => {
    expect(varsForScope(model(), "root").map((v) => v.name)).toEqual(["DATABASE_URL"]);
  });
  test("group returns members of that group", () => {
    expect(varsForScope(model(), "group:DB").map((v) => v.name)).toEqual(["DATABASE_URL"]);
  });
  test("a consumer id returns variables wired to it", () => {
    expect(varsForScope(model(), "app:api").map((v) => v.name).sort()).toEqual(["DATABASE_URL", "PORT"]);
  });
});

describe("stepScope", () => {
  test("skips a header row when moving down", () => {
    const s = buildScopes(model()); // idx2=Root, idx3=APPS(header), idx4=api
    expect(stepScope(s, 2, 1)).toBe(4);
  });
  test("skips a header row when moving up", () => {
    const s = buildScopes(model()); // idx4=api, idx3=APPS(header), idx2=Root
    expect(stepScope(s, 4, -1)).toBe(2);
  });
  test("clamps at the end", () => {
    const s = buildScopes(model());
    const last = s.length - 1;
    expect(stepScope(s, last, 1)).toBe(last);
  });
  test("clamps at the start", () => {
    expect(stepScope(buildScopes(model()), 0, -1)).toBe(0);
  });
  test("skips consecutive header rows", () => {
    const scopes = [
      { id: "all", label: "All", kind: "all" as const },
      { id: "h1", label: "H1", kind: "header" as const },
      { id: "h2", label: "H2", kind: "header" as const },
      { id: "app:api", label: "api", kind: "app" as const },
    ];
    expect(stepScope(scopes, 0, 1)).toBe(3);
  });
});

describe("isSelectable", () => {
  test("headers are not selectable, everything else is", () => {
    expect(isSelectable({ id: "header:apps", label: "APPS", kind: "header" })).toBe(false);
    expect(isSelectable({ id: "all", label: "All", kind: "all" })).toBe(true);
    expect(isSelectable({ id: "app:api", label: "api", kind: "app" })).toBe(true);
  });
});
