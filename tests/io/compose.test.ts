import { expect, test } from "bun:test";
import type { RepoModel } from "../../src/core/types.ts";
import { detectStyle, findRegions, prefixFor, renderRegionBody } from "../../src/io/compose.ts";

test("findRegions captures token, indent, and line span", () => {
  const text = [
    "services:",
    "  api:",
    "    environment:",
    "      - NODE_ENV=production",
    "      # <menv:api>",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture
    "      - OLD=${API_OLD}",
    "      # </menv>",
  ].join("\n");
  const regions = findRegions(text);
  expect(regions).toHaveLength(1);
  expect(regions[0]!.token).toBe("api");
  expect(regions[0]!.indent).toBe("      ");
  expect(regions[0]!.open).toBe(4);
  expect(regions[0]!.close).toBe(6);
});

test("findRegions ignores an unterminated open marker", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture
  const text = ["    # <menv:api>", "    - X=${API_X}"].join("\n");
  expect(findRegions(text)).toEqual([]);
});

test("findRegions tolerates an echoed name on the close tag and finds multiple regions", () => {
  const text = [
    "    # <menv:api>",
    "    # </menv:api>",
    "    # <menv:web>",
    "    # </menv>",
  ].join("\n");
  expect(findRegions(text).map((r) => r.token)).toEqual(["api", "web"]);
});

test("prefixFor uppercases and normalizes non-alphanumerics", () => {
  expect(prefixFor("api")).toBe("API");
  expect(prefixFor("web-admin")).toBe("WEB_ADMIN");
  expect(prefixFor("@acme/api")).toBe("ACME_API");
  expect(prefixFor("root")).toBe("ROOT");
});

const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "", group: "DB", secret: true, wiring: [{ consumer: "app:api" }] },
    { id: "v2", name: "REDIS_URL", description: "", group: null, secret: false, wiring: [{ consumer: "app:api", unapplied: ["prod"] }] },
  ],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
  values: { v1: { dev: "pg://x", prod: "pg://p" }, v2: { dev: "redis://x", prod: "redis://p" } },
  recipients: [],
};

test("detectStyle reads sequence vs mapping from a sibling, defaulting to seq", () => {
  const seq = ["    environment:", "      - X=1", "      # <menv:api>", "      # </menv>"].join("\n");
  expect(detectStyle(seq.split("\n"), findRegions(seq)[0]!)).toBe("seq");
  const map = ["    environment:", "      X: 1", "      # <menv:api>", "      # </menv>"].join("\n");
  expect(detectStyle(map.split("\n"), findRegions(map)[0]!)).toBe("map");
  const empty = ["    environment:", "      # <menv:api>", "      # </menv>"].join("\n");
  expect(detectStyle(empty.split("\n"), findRegions(empty)[0]!)).toBe("seq");
});

test("renderRegionBody emits only applied vars, group-then-name sorted, with prefixed refs", () => {
  // dev: both applied → DB-group DATABASE_URL first, then REDIS_URL.
  expect(renderRegionBody(model, "app:api", "API", "dev", "seq")).toEqual([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docker-compose interpolation fixture
    "- DATABASE_URL=${API_DATABASE_URL}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docker-compose interpolation fixture
    "- REDIS_URL=${API_REDIS_URL}",
  ]);
  // prod: REDIS_URL is unapplied → omitted entirely.
  expect(renderRegionBody(model, "app:api", "API", "prod", "seq")).toEqual([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docker-compose interpolation fixture
    "- DATABASE_URL=${API_DATABASE_URL}",
  ]);
  // mapping style.
  expect(renderRegionBody(model, "app:api", "API", "dev", "map")).toEqual([
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docker-compose interpolation fixture
    "DATABASE_URL: ${API_DATABASE_URL}",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docker-compose interpolation fixture
    "REDIS_URL: ${API_REDIS_URL}",
  ]);
});
