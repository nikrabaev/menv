import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumerIdsOf, isWired, wiringFor } from "../../src/core/model.ts";
import { scanRepo } from "../../src/io/discovery.ts";
import { writeGeneratedFiles } from "../../src/io/generate.ts";

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
  expect(consumerIdsOf(node[0]!).sort()).toEqual(["app:api", "app:web"]);
  expect(model.values[node[0]!.id]!.dev).toBe("development");

  const webOnly = model.variables.find((v) => v.name === "WEB_ONLY")!;
  expect(consumerIdsOf(webOnly)).toEqual(["app:web"]);
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
  const web = node.find((v) => isWired(v, "app:web"))!;
  const api = node.find((v) => isWired(v, "app:api"))!;
  expect(web.id).not.toBe(api.id);
  expect(consumerIdsOf(web)).toEqual(["app:web"]);
  expect(consumerIdsOf(api)).toEqual(["app:api"]);
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
  expect(consumerIdsOf(shared).sort()).toEqual(["app:api", "app:web"]);
  expect(model.values[shared.id]!.dev).toBe("development");
  expect(consumerIdsOf(lone)).toEqual(["app:worker"]);
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
  expect(consumerIdsOf(shared).sort()).toEqual(["app:api", "root"]);

  const rootOnly = model.variables.find((v) => v.name === "ROOT_ONLY")!;
  expect(consumerIdsOf(rootOnly)).toEqual(["root"]);
  expect(model.values[rootOnly.id]!.dev).toBe("y");
});

test("a consumer with .env.<env> files is detected as per-env; plain .env stays single", async () => {
  const root = await setup(["web", "api"]);
  // api keeps per-environment files; web has only a plain .env (+ local/example).
  await Bun.write(join(root, "apps", "api", ".env.development"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "api", ".env.production"), "PORT=8080\n");
  await Bun.write(join(root, "apps", "web", ".env"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "web", ".env.local"), "PORT=3001\n");
  await Bun.write(join(root, "apps", "web", ".env.example"), "PORT=\n");

  const { model } = await scanRepo(root);

  const api = model.consumers.find((c) => c.id === "app:api")!;
  const web = model.consumers.find((c) => c.id === "app:web")!;
  expect(api.envMode).toBe("perenv");
  expect(web.envMode).toBe("single");

  // `.env.local` keeps the app single, but its key becomes a separate `local`
  // variable alongside the base one (different value, different file on write).
  const ports = model.variables.filter((v) => v.name === "PORT" && isWired(v, "app:web"));
  const base = ports.find((v) => !v.local)!;
  const local = ports.find((v) => v.local)!;
  expect(local.id).toBe("var:PORT.local");
  expect(local.id.endsWith(".local")).toBe(true);
  expect(model.values[base.id]!.dev).toBe("3000");
  expect(model.values[local.id]!.dev).toBe("3001");
});

test(".env.<env>.local becomes a local variable on that env and flips the app to perenv", async () => {
  const root = await setup(["api"]);
  await Bun.write(join(root, "apps", "api", ".env.production"), "API_URL=https://prod\n");
  await Bun.write(join(root, "apps", "api", ".env.production.local"), "API_URL=https://prod-override\n");

  const { model } = await scanRepo(root);

  const api = model.consumers.find((c) => c.id === "app:api")!;
  expect(api.envMode).toBe("perenv");
  expect(model.environments.some((e) => e.id === "production")).toBe(true);

  const vars = model.variables.filter((v) => v.name === "API_URL");
  const base = vars.find((v) => !v.local)!;
  const local = vars.find((v) => v.local)!;
  expect(local.id).toBe("var:API_URL.local");
  expect(local.local).toBe(true);
  expect(model.values[base.id]!.production).toBe("https://prod");
  expect(model.values[local.id]!.production).toBe("https://prod-override");
});

test("a var present in one env file but absent from another is wired-but-unapplied there", async () => {
  const root = await setup(["api"]);
  await Bun.write(join(root, "apps", "api", ".env.development"), "FOO=1\nBAR=2\n");
  await Bun.write(join(root, "apps", "api", ".env.production"), "FOO=9\n");

  const { model } = await scanRepo(root);

  const foo = model.variables.find((v) => v.name === "FOO")!;
  const bar = model.variables.find((v) => v.name === "BAR")!;
  // FOO is present (active) in both env files ⇒ applied everywhere.
  expect(wiringFor(foo, "app:api")?.unapplied ?? []).toEqual([]);
  // BAR is only in .env.development ⇒ wired to api but not applied in production.
  expect(wiringFor(bar, "app:api")?.unapplied).toEqual(["production"]);
  expect(model.values[bar.id]!.development).toBe("2");
  expect(model.values[bar.id]!.production).toBeUndefined();
});

test("a commented-out var in a scanned file is wired but not applied there", async () => {
  const root = await setup(["api"]);
  await Bun.write(join(root, "apps", "api", ".env.development"), "FOO=1\n# BAR=2\n");

  const { model } = await scanRepo(root);

  const bar = model.variables.find((v) => v.name === "BAR")!;
  expect(isWired(bar, "app:api")).toBe(true);
  expect(wiringFor(bar, "app:api")?.unapplied).toEqual(["development"]);
  // Its commented value is still captured into the vault so it round-trips.
  expect(model.values[bar.id]!.development).toBe("2");
});

test("example-only keys absent from a consumer's real env file are wired-but-unapplied there", async () => {
  const root = await setup(["web"]);
  // .env.example documents three keys; .env.development only actually sets one.
  await Bun.write(
    join(root, "apps", "web", ".env.example"),
    "VITE_API_URL=http://localhost:3000\nVITE_AUTH_URL=http://localhost:3000\nVITE_ENABLE_DEVTOOLS=true\n",
  );
  await Bun.write(join(root, "apps", "web", ".env.development"), "VITE_ENABLE_DEVTOOLS=true\n");

  const { model } = await scanRepo(root);

  // Present in .env.development ⇒ applied there.
  const devtools = model.variables.find((v) => v.name === "VITE_ENABLE_DEVTOOLS")!;
  expect(wiringFor(devtools, "app:web")?.unapplied ?? []).toEqual([]);

  // Only in .env.example, absent from .env.development ⇒ wired but not applied
  // there, so generation writes them commented-out rather than as live blanks.
  const apiUrl = model.variables.find((v) => v.name === "VITE_API_URL")!;
  const authUrl = model.variables.find((v) => v.name === "VITE_AUTH_URL")!;
  expect(isWired(apiUrl, "app:web")).toBe(true);
  expect(wiringFor(apiUrl, "app:web")?.unapplied).toEqual(["development"]);
  expect(wiringFor(authUrl, "app:web")?.unapplied).toEqual(["development"]);
  // The example value is still captured as the template default.
  expect(apiUrl.example).toBe("http://localhost:3000");
});

test("init round-trip: example-only keys regenerate commented-out in the env file they're absent from", async () => {
  const root = await setup(["web"]);
  await Bun.write(
    join(root, "apps", "web", ".env.example"),
    "VITE_API_URL=http://localhost:3000\nVITE_AUTH_URL=http://localhost:3000\nVITE_ENABLE_DEVTOOLS=true\n",
  );
  await Bun.write(join(root, "apps", "web", ".env.development"), "VITE_ENABLE_DEVTOOLS=true\n");

  // Scan (as `init` does), then regenerate the env files from the vault.
  const { model } = await scanRepo(root);
  await writeGeneratedFiles(model, "development", "ts1");

  const dev = await Bun.file(join(root, "apps", "web", ".env.development")).text();
  // The applied key stays live; the example-only keys come back commented-out
  // rather than as live blanks (the reported bug wrote them as `VITE_API_URL=`).
  expect(dev).toContain("VITE_ENABLE_DEVTOOLS=true");
  expect(dev).toContain("# VITE_API_URL=");
  expect(dev).toContain("# VITE_AUTH_URL=");
  expect(dev).not.toMatch(/^VITE_API_URL=/m);
  expect(dev).not.toMatch(/^VITE_AUTH_URL=/m);
});

test("a custom defaultEnv reclassifies plain .env/.env.local and labels it the default", async () => {
  const root = await setup(["web"]);
  await Bun.write(join(root, "apps", "web", ".env"), "PORT=3000\n");
  await Bun.write(join(root, "apps", "web", ".env.local"), "PORT=3001\n");

  const { model } = await scanRepo(root, { defaultEnv: "staging" });

  // The single-mode consumer's .env imports under the custom env, not "dev".
  const ports = model.variables.filter((v) => v.name === "PORT" && isWired(v, "app:web"));
  const base = ports.find((v) => !v.local)!;
  const local = ports.find((v) => v.local)!;
  expect(model.values[base.id]!.staging).toBe("3000");
  expect(model.values[local.id]!.staging).toBe("3001");
  expect(model.values[base.id]!.dev).toBeUndefined();

  // The custom env becomes the sole, default environment.
  expect(model.environments.map((e) => e.id)).toEqual(["staging"]);
  expect(model.environments.find((e) => e.id === "staging")!.isDefault).toBe(true);
});

test("a custom defaultEnv seeds the environment when no env files exist", async () => {
  const root = await setup(["web"]); // apps exist but carry no .env files

  const { model } = await scanRepo(root, { defaultEnv: "staging" });

  expect(model.environments.map((e) => e.id)).toEqual(["staging"]);
  expect(model.environments[0]!.isDefault).toBe(true);
});

test("an empty or whitespace defaultEnv falls back to dev", async () => {
  const root = await setup(["web"]);

  const { model } = await scanRepo(root, { defaultEnv: "   " });

  expect(model.environments.map((e) => e.id)).toEqual(["dev"]);
  expect(model.environments[0]!.isDefault).toBe(true);
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
  expect(consumerIdsOf(redis)).toEqual(["app:api"]);
  expect(model.values[redis.id]).toBeUndefined();
});
