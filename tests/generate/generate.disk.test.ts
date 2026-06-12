import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { applyPreview, previewGenerate, vaultsNeeded } from "../../src/generate/generate.ts";
import { hasOwnershipMarker } from "../../src/generate/ownership.ts";
import type { Registry } from "../../src/registry/types.ts";
import type { VaultSession } from "../../src/vault/provider.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const AUTH = { vaultAuth: {}, env: {} };

// One consumer with secrets split + example, one plain; values incl. a chain,
// a runtime global, a static global, a disabled entry, and a missing value.
async function fixture(): Promise<{ root: string; registry: Registry; sessions: Map<string, VaultSession> }> {
  const registry = makeRegistry();
  registry.consumers.web = {
    strategyType: "single",
    strategyConfig: { baseDir: "apps/web", filename: ".env", secretsAsLocalOverrides: true, example: true },
  };
  registry.groups = { db: { title: "Database" } };
  registry.globals.FQDN = {
    values: {
      local: { source: "static", value: "localhost:3000" },
      production: { source: "runtime" },
    },
  };
  registry.variables = {
    DATABASE_URL: {
      groupKey: "db",
      secret: true,
      example: "postgres://user:pass@host/db",
      vaultMapping: { local: { web: { key: "k-db" } }, production: { web: { key: "k-db-prod" } } },
    },
    PUBLIC_URL: { vaultMapping: { local: { web: { key: "k-url" } }, production: { web: { key: "k-url-prod" } } } },
    HEALTH_URL: { vaultMapping: { local: { web: { key: "k-health" } } } },
    FLAG: { vaultMapping: { local: { web: { key: "k-flag", disabled: true } } } },
    EMPTY: { vaultMapping: { local: { web: { key: "k-unset" } } } },
  };
  const root = await tmpRepo(registry);
  roots.push(root);
  const local = await openVaultSession(root, registry, "local", AUTH);
  await local.set("k-db", "postgres://localhost/app");
  await local.set("k-url", "https://${FQDN}/api");
  await local.set("k-health", "${PUBLIC_URL}/health");
  await local.set("k-flag", "on");
  const production = await openVaultSession(root, registry, "production", AUTH);
  await production.set("k-db-prod", "postgres://prod/app");
  await production.set("k-url-prod", "https://${FQDN}/api");
  const sessions = new Map<string, VaultSession>([
    ["local", local],
    ["production", production],
  ]);
  return { root, registry, sessions };
}

describe("previewGenerate + applyPreview", () => {
  test("renders main/.local/.env.example with interpolation and disabled lines", async () => {
    const { root, registry, sessions } = await fixture();
    const preview = await previewGenerate(root, registry, { consumer: "web" }, sessions);
    const byPath = new Map(preview.writes.map((w) => [w.path, w.content]));
    const main = byPath.get("apps/web/.env") as string;
    expect(hasOwnershipMarker(main)).toBe(true);
    expect(main).toContain("PUBLIC_URL=https://localhost:3000/api"); // static global expanded
    expect(main).toContain("HEALTH_URL=https://localhost:3000/api/health"); // chained
    expect(main).toContain("# FLAG=on"); // disabled → commented
    expect(main).toContain("EMPTY="); // missing value renders empty
    expect(main).not.toContain("DATABASE_URL"); // secret split out
    const local = byPath.get("apps/web/.env.local") as string;
    expect(local).toContain("# ── Database ──");
    expect(local).toContain("DATABASE_URL=postgres://localhost/app");
    const example = byPath.get("apps/web/.env.example") as string;
    expect(example).toContain("DATABASE_URL=postgres://user:pass@host/db");
    expect(example).not.toContain("postgres://localhost/app");
    expect(preview.warnings.some((w) => w.code === "MISSING_VALUE" && w.message.includes("EMPTY"))).toBe(true);
    await applyPreview(root, preview);
    expect(await Bun.file(join(root, "apps/web/.env")).text()).toBe(main);
  });

  test("--vault production: runtime global passes through literally", async () => {
    const { root, registry, sessions } = await fixture();
    const preview = await previewGenerate(root, registry, { consumer: "web", vault: "production" }, sessions);
    const main = preview.writes.find((w) => w.path === "apps/web/.env")?.content as string;
    expect(main).toContain("PUBLIC_URL=https://${FQDN}/api");
  });

  test("second run is unchanged; foreign file is refused, not overwritten", async () => {
    const { root, registry, sessions } = await fixture();
    await applyPreview(root, await previewGenerate(root, registry, { consumer: "web" }, sessions));
    const again = await previewGenerate(root, registry, { consumer: "web" }, sessions);
    expect(again.writes).toEqual([]);
    expect(again.unchanged).toContain("apps/web/.env");
    await Bun.write(join(root, "apps/web/.env"), "HAND=made\n"); // user takes ownership
    const third = await previewGenerate(root, registry, { consumer: "web" }, sessions);
    expect(third.refused).toContain("apps/web/.env");
    expect(third.writes.map((w) => w.path)).not.toContain("apps/web/.env");
    expect(await Bun.file(join(root, "apps/web/.env")).text()).toBe("HAND=made\n");
  });

  test("an interpolation cycle aborts with VALIDATION before anything is written", async () => {
    const { root, registry, sessions } = await fixture();
    const local = sessions.get("local") as VaultSession;
    await local.set("k-url", "${HEALTH_URL}"); // HEALTH_URL already references PUBLIC_URL
    try {
      await previewGenerate(root, registry, { consumer: "web" }, sessions);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect((e as MenvError).message).toContain("cycle");
    }
  });

  test("vaultsNeeded reflects targets", async () => {
    const { registry } = await fixture();
    expect(vaultsNeeded(registry, {}).sort()).toEqual(["local"]); // single consumers, default vault, no compose
    expect(vaultsNeeded(registry, { vault: "production" })).toEqual(["production"]);
  });
});
