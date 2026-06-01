import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepo } from "../../src/io/discovery.ts";

async function setup(apps: string[] = ["web", "api"]) {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  for (const a of apps) {
    await mkdir(join(root, "apps", a), { recursive: true });
    await Bun.write(join(root, "apps", a, "package.json"), JSON.stringify({ name: a }));
  }
  return root;
}

test("apps that share a value collapse into one variable wired to all of them", async () => {
  const root = await setup();
  await Bun.write(join(root, "apps", "web", ".env"), "NODE_ENV=development\nWEB_ONLY=1\n");
  await Bun.write(join(root, "apps", "api", ".env"), "NODE_ENV=development\nDATABASE_URL=pg://x\n");

  const { model } = await scanRepo(root);

  const node = model.variables.filter((v) => v.name === "NODE_ENV");
  expect(node.length).toBe(1);
  expect(node[0]!.id).toBe("var:NODE_ENV");
  expect(node[0]!.consumers.sort()).toEqual(["app:api", "app:web"]);
  expect(model.values[node[0]!.id]!.dev).toBe("development");

  const webOnly = model.variables.find((v) => v.name === "WEB_ONLY")!;
  expect(webOnly.consumers).toEqual(["app:web"]);
  expect(model.values["var:DATABASE_URL"]!.dev).toBe("pg://x");
});

test("same name with different values across apps splits into one variable per value", async () => {
  const root = await setup();
  await Bun.write(join(root, "apps", "web", ".env"), "NODE_ENV=production\n");
  await Bun.write(join(root, "apps", "api", ".env"), "NODE_ENV=development\n");

  const { model } = await scanRepo(root);

  const node = model.variables.filter((v) => v.name === "NODE_ENV");
  expect(node.length).toBe(2);
  expect(node.map((v) => v.id).sort()).toEqual(["var:NODE_ENV", "var:NODE_ENV#2"]);
  const web = node.find((v) => v.consumers.includes("app:web"))!;
  const api = node.find((v) => v.consumers.includes("app:api"))!;
  expect(web.id).not.toBe(api.id);
  expect(web.consumers).toEqual(["app:web"]);
  expect(api.consumers).toEqual(["app:api"]);
  expect(model.values[api.id]!.dev).toBe("development");
  expect(model.values[web.id]!.dev).toBe("production");
});

test("a value shared by some apps groups them; the odd one out gets its own variable", async () => {
  const root = await setup(["web", "api", "worker"]);
  await Bun.write(join(root, "apps", "web", ".env"), "NODE_ENV=development\n");
  await Bun.write(join(root, "apps", "api", ".env"), "NODE_ENV=development\n");
  await Bun.write(join(root, "apps", "worker", ".env"), "NODE_ENV=production\n");

  const { model } = await scanRepo(root);

  const node = model.variables.filter((v) => v.name === "NODE_ENV");
  expect(node.length).toBe(2);
  // The majority value-group keeps the bare id.
  const shared = node.find((v) => v.id === "var:NODE_ENV")!;
  const lone = node.find((v) => v.id === "var:NODE_ENV#2")!;
  expect(shared.consumers.sort()).toEqual(["app:api", "app:web"]);
  expect(model.values[shared.id]!.dev).toBe("development");
  expect(lone.consumers).toEqual(["app:worker"]);
  expect(model.values[lone.id]!.dev).toBe("production");
});

test("a repo-root .env is scanned and groups with apps that share the value", async () => {
  const root = await setup();
  await Bun.write(join(root, ".env"), "SHARED=x\nROOT_ONLY=y\n");
  await Bun.write(join(root, "apps", "api", ".env"), "SHARED=x\n");

  const { model } = await scanRepo(root);

  // The root target is always present as a wireable consumer.
  expect(model.consumers.some((c) => c.id === "root" && c.path === ".")).toBe(true);

  const shared = model.variables.find((v) => v.name === "SHARED")!;
  expect(shared.consumers.sort()).toEqual(["app:api", "root"]);

  const rootOnly = model.variables.find((v) => v.name === "ROOT_ONLY")!;
  expect(rootOnly.consumers).toEqual(["root"]);
  expect(model.values[rootOnly.id]!.dev).toBe("y");
});

test("imports example values and creates example-only variables", async () => {
  const root = await setup();
  await Bun.write(join(root, "apps", "api", ".env"), "DATABASE_URL=pg://real\n");
  await Bun.write(join(root, "apps", "api", ".env.example"), "DATABASE_URL=pg://example\nREDIS_URL=redis://localhost:6379\n");

  const { model } = await scanRepo(root);

  const db = model.variables.find((v) => v.name === "DATABASE_URL")!;
  expect(db.example).toBe("pg://example");
  expect(model.values[db.id]!.dev).toBe("pg://real");

  const redis = model.variables.find((v) => v.name === "REDIS_URL")!;
  expect(redis.example).toBe("redis://localhost:6379");
  expect(redis.consumers).toEqual(["app:api"]);
  expect(model.values[redis.id]).toBeUndefined();
});
