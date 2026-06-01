import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepo } from "../../src/io/discovery.ts";

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "web" }));
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  return root;
}

test("shared variable with identical values across apps is one global", async () => {
  const root = await setup();
  await Bun.write(join(root, "apps", "web", ".env"), "NODE_ENV=development\nWEB_ONLY=1\n");
  await Bun.write(join(root, "apps", "api", ".env"), "NODE_ENV=development\nDATABASE_URL=pg://x\n");

  const { model } = await scanRepo(root);

  const node = model.variables.filter((v) => v.name === "NODE_ENV");
  expect(node.length).toBe(1);
  expect(node[0].tier).toBe("global");
  expect(node[0].consumers.sort()).toEqual(["app:api", "app:web"]);
  expect(model.values[node[0].id].dev).toBe("development");

  const webOnly = model.variables.find((v) => v.name === "WEB_ONLY")!;
  expect(webOnly.tier).toBe("local");
  expect(webOnly.ownerApp).toBe("app:web");
  expect(model.values["var:DATABASE_URL"].dev).toBe("pg://x");
});

test("same name with different values across apps becomes per-app locals", async () => {
  const root = await setup();
  await Bun.write(join(root, "apps", "web", ".env"), "NODE_ENV=production\n");
  await Bun.write(join(root, "apps", "api", ".env"), "NODE_ENV=development\n");

  const { model } = await scanRepo(root);

  const node = model.variables.filter((v) => v.name === "NODE_ENV");
  expect(node.length).toBe(2);
  expect(node.every((v) => v.tier === "local")).toBe(true);
  const api = node.find((v) => v.ownerApp === "app:api")!;
  const web = node.find((v) => v.ownerApp === "app:web")!;
  expect(api.id).not.toBe(web.id);
  expect(model.values[api.id].dev).toBe("development");
  expect(model.values[web.id].dev).toBe("production");
});

test("imports example values and creates example-only locals", async () => {
  const root = await setup();
  await Bun.write(join(root, "apps", "api", ".env"), "DATABASE_URL=pg://real\n");
  await Bun.write(join(root, "apps", "api", ".env.example"), "DATABASE_URL=pg://example\nREDIS_URL=redis://localhost:6379\n");

  const { model } = await scanRepo(root);

  const db = model.variables.find((v) => v.name === "DATABASE_URL")!;
  expect(db.example).toBe("pg://example");
  expect(model.values[db.id].dev).toBe("pg://real");

  const redis = model.variables.find((v) => v.name === "REDIS_URL")!;
  expect(redis.example).toBe("redis://localhost:6379");
  expect(redis.tier).toBe("local");
  expect(redis.ownerApp).toBe("app:api");
  expect(model.values[redis.id]).toBeUndefined();
});
