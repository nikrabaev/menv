import { expect, test, describe } from "bun:test";
import { buildScopes, varsForScope, stepScope } from "../../src/ui/scopes.ts";
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
  test("starts with All then Root", () => {
    const s = buildScopes(model());
    expect(s[0]).toEqual({ id: "all", label: "All", kind: "all" });
    expect(s[1]).toEqual({ id: "root", label: "Root", kind: "root" });
  });

  test("emits section headers followed by their members", () => {
    const labels = buildScopes(model()).map((x) => x.label);
    expect(labels).toEqual(["All", "Root", "APPS", "api", "web", "SERVICES", "postgres", "GROUPS", "DB"]);
    expect(buildScopes(model()).find((x) => x.label === "APPS")!.kind).toBe("header");
  });

  test("omits a section header when it has no members", () => {
    const m = model();
    m.consumers = m.consumers.filter((c) => c.kind === "app"); // drop the service
    const labels = buildScopes(m).map((x) => x.label);
    expect(labels).toContain("APPS");
    expect(labels).not.toContain("SERVICES");
  });
});

describe("varsForScope", () => {
  test("all returns every variable", () => {
    expect(varsForScope(model(), "all").map((v) => v.name).sort()).toEqual(["DATABASE_URL", "PORT", "WEB_FLAG"]);
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
    const s = buildScopes(model()); // idx1=Root, idx2=APPS(header), idx3=api
    expect(stepScope(s, 1, 1)).toBe(3);
  });
  test("skips a header row when moving up", () => {
    const s = buildScopes(model()); // idx3=api, idx2=APPS(header), idx1=Root
    expect(stepScope(s, 3, -1)).toBe(1);
  });
  test("clamps at the end", () => {
    const s = buildScopes(model());
    const last = s.length - 1;
    expect(stepScope(s, last, 1)).toBe(last);
  });
  test("clamps at the start", () => {
    expect(stepScope(buildScopes(model()), 0, -1)).toBe(0);
  });
});
