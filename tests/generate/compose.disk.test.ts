import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { openVaultSession } from "../../src/cli/run.ts";
import { findMarkerRegions, previewCompose, spliceRegions } from "../../src/generate/compose.ts";
import type { Registry } from "../../src/registry/types.ts";
import type { VaultSession } from "../../src/vault/provider.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

describe("findMarkerRegions", () => {
  test("finds consumer regions with their indentation", () => {
    const yaml = "services:\n  api:\n    environment:\n      # <menv:api>\n      - OLD=1\n      # </menv>\n";
    const { regions, errors } = findMarkerRegions(yaml);
    expect(errors).toEqual([]);
    expect(regions).toEqual([{ consumer: "api", start: 3, end: 5, indent: "      " }]);
  });

  test("reports unclosed and nested markers", () => {
    expect(findMarkerRegions("# <menv:a>\n").errors[0]).toContain("unclosed");
    expect(findMarkerRegions("# <menv:a>\n# <menv:b>\n# </menv>\n").errors.some((e) => e.includes("nested"))).toBe(true);
    expect(findMarkerRegions("# </menv>\n").errors[0]).toContain("unmatched");
  });
});

describe("spliceRegions", () => {
  test("replaces region bodies, never touching lines outside the markers", () => {
    const yaml = "a: 1\n      # <menv:api>\n      - OLD=1\n      # </menv>\nb: 2\n";
    const { regions } = findMarkerRegions(yaml);
    const out = spliceRegions(yaml, regions, new Map([[1, ["      - NEW=${API_NEW}"]]]));
    expect(out).toBe("a: 1\n      # <menv:api>\n      - NEW=${API_NEW}\n      # </menv>\nb: 2\n");
  });
});

describe("previewCompose", () => {
  async function fixture(): Promise<{ root: string; registry: Registry; sessions: Map<string, VaultSession> }> {
    const registry = makeRegistry();
    registry.variables = {
      DATABASE_URL: { vaultMapping: { local: { api: { key: "k-db" } } } },
      FLAG: { vaultMapping: { local: { api: { key: "k-flag", disabled: true } } } },
    };
    registry.compose = { files: ["docker-compose.yml"] };
    const root = await tmpRepo(registry);
    roots.push(root);
    await Bun.write(
      join(root, "docker-compose.yml"),
      "services:\n  api:\n    environment:\n      - STATIC=keep\n      # <menv:api>\n      # </menv>\n",
    );
    const local = await openVaultSession(root, registry, "local", { vaultAuth: {}, env: {} });
    await local.set("k-db", "postgres://localhost/app");
    await local.set("k-flag", "on");
    return { root, registry, sessions: new Map([["local", local]]) };
  }

  test("fills the region, preserves hand lines, writes .env.compose (disabled commented)", async () => {
    const { root, registry, sessions } = await fixture();
    const preview = await previewCompose(root, registry, { vault: "local" }, sessions);
    const composed = preview.writes.find((w) => w.path === "docker-compose.yml")?.content as string;
    expect(composed).toContain("      - STATIC=keep"); // hand line untouched
    expect(composed).toContain("      - DATABASE_URL=${API_DATABASE_URL}");
    expect(composed).toContain("      - FLAG=${API_FLAG}"); // surface line present even when disabled
    const envCompose = preview.writes.find((w) => w.path === ".env.compose")?.content as string;
    expect(envCompose).toContain("API_DATABASE_URL=postgres://localhost/app");
    expect(envCompose).toContain("# API_FLAG=on"); // disabled value commented → interpolates empty
    expect(preview.errors).toEqual([]);
  });

  test("a marker naming an unknown consumer is an error", async () => {
    const { root, registry, sessions } = await fixture();
    await Bun.write(join(root, "docker-compose.yml"), "x:\n  # <menv:ghost>\n  # </menv>\n");
    const preview = await previewCompose(root, registry, { vault: "local" }, sessions);
    expect(preview.errors.some((e) => e.message.includes("ghost"))).toBe(true);
    expect(preview.writes).toEqual([]); // nothing written when a file has an error
  });

  test("an unverified vault writes no .env.compose, so an existing one is left intact", async () => {
    const { root, registry } = await fixture();
    // No session for the vault — every region fails to resolve. A header-only
    // .env.compose would clobber a previously-correct file, so emit nothing.
    const preview = await previewCompose(root, registry, { vault: "local" }, new Map());
    expect(preview.warnings.some((w) => w.code === "UNVERIFIED_VAULT")).toBe(true);
    expect(preview.writes.find((w) => w.path === ".env.compose")).toBeUndefined();
  });
});

describe("previewCompose — multi-region and multi-directory", () => {
  const AUTH = { vaultAuth: {}, env: {} };

  test("two consumers sharing a var name get distinct prefixed keys in one .env.compose", async () => {
    const registry = makeRegistry();
    registry.consumers = {
      api: { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env" } },
      web: { strategyType: "single", strategyConfig: { baseDir: "apps/web", filename: ".env" } },
    };
    registry.variables = { URL: { vaultMapping: { local: { api: { key: "k-api" }, web: { key: "k-web" } } } } };
    registry.compose = { files: ["docker-compose.yml"] };
    const root = await tmpRepo(registry);
    roots.push(root);
    await Bun.write(
      join(root, "docker-compose.yml"),
      "services:\n  api:\n    environment:\n      # <menv:api>\n      # </menv>\n  web:\n    environment:\n      # <menv:web>\n      # </menv>\n",
    );
    const local = await openVaultSession(root, registry, "local", AUTH);
    await local.set("k-api", "http://api");
    await local.set("k-web", "http://web");
    const preview = await previewCompose(root, registry, { vault: "local" }, new Map([["local", local]]));
    expect(preview.errors).toEqual([]);
    const envCompose = preview.writes.find((w) => w.path === ".env.compose")?.content as string;
    expect(envCompose).toContain("API_URL=http://api"); // prefixed → no collision
    expect(envCompose).toContain("WEB_URL=http://web");
    const composed = preview.writes.find((w) => w.path === "docker-compose.yml")?.content as string;
    expect(composed).toContain("- URL=${API_URL}");
    expect(composed).toContain("- URL=${WEB_URL}");
  });

  test("compose files in two directories each get their own sibling .env.compose", async () => {
    const registry = makeRegistry();
    registry.consumers = { api: { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env" } } };
    registry.variables = { URL: { vaultMapping: { local: { api: { key: "k-url" } } } } };
    registry.compose = { files: ["a/docker-compose.yml", "b/docker-compose.yml"] };
    const root = await tmpRepo(registry);
    roots.push(root);
    const yaml = "x:\n  # <menv:api>\n  # </menv>\n";
    await Bun.write(join(root, "a/docker-compose.yml"), yaml);
    await Bun.write(join(root, "b/docker-compose.yml"), yaml);
    const local = await openVaultSession(root, registry, "local", AUTH);
    await local.set("k-url", "http://x");
    const preview = await previewCompose(root, registry, { vault: "local" }, new Map([["local", local]]));
    const paths = preview.writes.map((w) => w.path);
    expect(paths).toContain("a/.env.compose");
    expect(paths).toContain("b/.env.compose");
  });
});
