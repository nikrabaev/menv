import { describe, expect, test } from "bun:test";
import type { RepoModel } from "../../src/core/types.ts";
import { buildScopes, isSelectable, stepScope, varsForScope } from "../../src/ui/scopes.ts";

function model(): RepoModel {
  return {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "v1", name: "DATABASE_URL", description: "", group: "DB", secret: true, wiring: [{ consumer: "app:api" }] },
      { id: "v2", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] },
      { id: "v3", name: "WEB_FLAG", description: "", group: null, secret: false, wiring: [{ consumer: "app:web" }] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api" },
      { kind: "app", id: "app:web", name: "web", path: "apps/web" },
    ],
    values: {},
    recipients: [],
  };
}

describe("buildScopes", () => {
  test("starts with All", () => {
    expect(buildScopes(model())[0]).toEqual({ id: "all", label: "All", kind: "all" });
  });

  test("emits section headers followed by their members", () => {
    const labels = buildScopes(model()).map((x) => x.label);
    expect(labels).toEqual(["All", "TARGETS", "api", "web", "GROUPS", "DB"]);
    expect(buildScopes(model()).find((x) => x.label === "TARGETS")!.kind).toBe("header");
  });

  test("omits a section header when it has no members", () => {
    const m = model();
    for (const v of m.variables) v.group = null; // no grouped variables left
    const labels = buildScopes(m).map((x) => x.label);
    expect(labels).toContain("TARGETS");
    expect(labels).not.toContain("GROUPS");
  });

  test("omits consumers that have no wired variables", () => {
    const m = model();
    m.consumers.push({ kind: "app", id: "app:worker", name: "worker", path: "apps/worker" });
    // worker has no wired variables, so it does not appear
    expect(buildScopes(m).map((x) => x.label)).not.toContain("worker");
    // wire a variable to it — now it appears
    m.variables[0]!.wiring = [...m.variables[0]!.wiring, { consumer: "app:worker" }];
    expect(buildScopes(m).map((x) => x.label)).toContain("worker");
  });
});

describe("varsForScope", () => {
  test("all returns every variable", () => {
    expect(varsForScope(model(), "all").map((v) => v.name).sort()).toEqual(["DATABASE_URL", "PORT", "WEB_FLAG"]);
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
    const s = buildScopes(model()); // idx0=All, idx1=TARGETS(header), idx2=api
    expect(stepScope(s, 0, 1)).toBe(2);
  });
  test("skips a header row when moving up", () => {
    const s = buildScopes(model()); // idx2=api, idx1=TARGETS(header), idx0=All
    expect(stepScope(s, 2, -1)).toBe(0);
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
    expect(isSelectable({ id: "header:apps", label: "TARGETS", kind: "header" })).toBe(false);
    expect(isSelectable({ id: "all", label: "All", kind: "all" })).toBe(true);
    expect(isSelectable({ id: "app:api", label: "api", kind: "app" })).toBe(true);
  });
});
