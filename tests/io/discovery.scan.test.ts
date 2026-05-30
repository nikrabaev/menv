import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepo } from "../../src/io/discovery.ts";

test("builds a model: shared vars are global, single-use vars are local", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "web" }));
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  await Bun.write(join(root, "apps", "web", ".env"), "NODE_ENV=development\nWEB_ONLY=1\n");
  await Bun.write(join(root, "apps", "api", ".env"), "NODE_ENV=development\nDATABASE_URL=pg://x\n");

  const { model, valuesByEnv } = await scanRepo(root);
  const node = model.variables.find((v) => v.name === "NODE_ENV")!;
  expect(node.tier).toBe("global");
  const webOnly = model.variables.find((v) => v.name === "WEB_ONLY")!;
  expect(webOnly.tier).toBe("local");
  expect(webOnly.ownerApp).toBe("app:web");
  expect(valuesByEnv.dev.DATABASE_URL).toBe("pg://x");
});

test("gives same-named services in different compose files unique ids", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "docker-compose.yml"), "services:\n  web:\n    image: app\n");
  await Bun.write(join(root, "docker-compose.dev.yml"), "services:\n  web:\n    image: app-dev\n");

  const { model } = await scanRepo(root);
  const serviceIds = model.consumers.filter((c) => c.kind === "service").map((c) => c.id);
  expect(serviceIds.length).toBe(2);
  expect(new Set(serviceIds).size).toBe(2);
});
