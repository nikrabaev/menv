import { describe, expect, test } from "bun:test";
import type { RenderEntry } from "../../src/generate/render.ts";
import { renderEnvContent, renderExampleContent, splitSecrets } from "../../src/generate/render.ts";

const HEADER = "# H\n";
const groups = { db: { title: "Database" }, app: { title: "App" } };

function entry(over: Partial<RenderEntry> & { name: string }): RenderEntry {
  return { value: "", disabled: false, secret: false, ...over };
}

describe("renderEnvContent", () => {
  test("groups in registry order with headers, ungrouped last, names sorted, disabled commented", () => {
    const out = renderEnvContent(
      [
        entry({ name: "ZED", value: "z" }),
        entry({ name: "DB_POOL", value: "10", groupKey: "db", disabled: true }),
        entry({ name: "DATABASE_URL", value: "postgres://x", groupKey: "db" }),
        entry({ name: "APP_NAME", value: "menv", groupKey: "app" }),
      ],
      groups,
      HEADER,
    );
    expect(out).toBe(
      "# H\n" +
        "# ── Database ──\n" +
        "DATABASE_URL=postgres://x\n" +
        "# DB_POOL=10\n" +
        "\n" +
        "# ── App ──\n" +
        "APP_NAME=menv\n" +
        "\n" +
        "ZED=z\n",
    );
  });

  test("empty entry list renders just the header", () => {
    expect(renderEnvContent([], groups, HEADER)).toBe("# H\n");
  });
});

describe("splitSecrets", () => {
  test("secret entries go to local when splitting is on; otherwise all stay main", () => {
    const entries = [entry({ name: "PUBLIC", value: "p" }), entry({ name: "TOKEN", value: "t", secret: true })];
    const split = splitSecrets(entries, true);
    expect(split.main.map((e) => e.name)).toEqual(["PUBLIC"]);
    expect(split.local.map((e) => e.name)).toEqual(["TOKEN"]);
    const noSplit = splitSecrets(entries, false);
    expect(noSplit.main).toHaveLength(2);
    expect(noSplit.local).toEqual([]);
  });
});

describe("renderExampleContent", () => {
  test("values-free template from the example field, disabled entries included plain", () => {
    const out = renderExampleContent(
      [
        entry({ name: "DATABASE_URL", value: "real-secret", groupKey: "db", example: "postgres://user:pass@host/db" }),
        entry({ name: "FLAG", value: "x", disabled: true }),
      ],
      groups,
      HEADER,
    );
    expect(out).toBe("# H\n# ── Database ──\nDATABASE_URL=postgres://user:pass@host/db\n\nFLAG=\n");
    expect(out).not.toContain("real-secret");
  });
});
