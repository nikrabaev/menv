import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectApps } from "../../src/io/discovery.ts";

test("detects pnpm + bun workspace packages", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  await mkdir(join(root, "apps", "web"), { recursive: true });
  await Bun.write(join(root, "apps", "web", "package.json"), JSON.stringify({ name: "web" }));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));

  const apps = await detectApps(root);
  const names = apps.map((a) => a.name).sort();
  expect(names).toEqual(["api", "web"]);
  expect(apps.find((a) => a.name === "web")!.path).toBe("apps/web");
});

test("falls back to package.json workspaces field", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
  await mkdir(join(root, "packages", "core"), { recursive: true });
  await Bun.write(join(root, "packages", "core", "package.json"), JSON.stringify({ name: "@x/core" }));

  const apps = await detectApps(root);
  expect(apps.map((a) => a.name)).toEqual(["@x/core"]);
});
