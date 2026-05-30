import { join, relative, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AppTarget } from "../core/types.ts";

async function readJson(path: string): Promise<any | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  try { return JSON.parse(await f.text()); } catch { return null; }
}

async function workspaceGlobs(root: string): Promise<string[]> {
  const pnpm = Bun.file(join(root, "pnpm-workspace.yaml"));
  if (await pnpm.exists()) {
    const doc = parseYaml(await pnpm.text());
    if (Array.isArray(doc?.packages)) return doc.packages as string[];
  }
  const pkg = await readJson(join(root, "package.json"));
  if (Array.isArray(pkg?.workspaces)) return pkg.workspaces as string[];
  if (Array.isArray(pkg?.workspaces?.packages)) return pkg.workspaces.packages as string[];
  return [];
}

export async function detectApps(root: string): Promise<AppTarget[]> {
  const globs = await workspaceGlobs(root);
  const apps: AppTarget[] = [];
  const seen = new Set<string>();
  for (const g of globs) {
    const glob = new Bun.Glob(`${g}/package.json`);
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
      const pkgPath = join(root, rel);
      if (seen.has(pkgPath)) continue;
      seen.add(pkgPath);
      const pkg = await readJson(pkgPath);
      if (!pkg) continue;
      const dir = dirname(rel);
      apps.push({
        kind: "app",
        id: `app:${pkg.name ?? dir}`,
        name: pkg.name ?? dir,
        path: relative(root, join(root, dir)) || ".",
        envFiles: {},
      });
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

import { parseDotenv } from "./dotenv.ts";
import { parseComposeServices } from "./compose.ts";
import type { Consumer, RepoModel, ServiceTarget, Variable } from "../core/types.ts";

function envIdForFile(filename: string): string {
  if (filename === ".env" || filename === ".env.local") return "dev";
  const m = /^\.env\.(.+)$/.exec(filename);
  if (!m || m[1] === "example") return "dev";
  return m[1];
}

export async function scanRepo(root: string): Promise<{
  model: RepoModel;
  valuesByEnv: Record<string, Record<string, string>>;
}> {
  const apps = await detectApps(root);

  // compose services
  const services: ServiceTarget[] = [];
  const composeGlob = new Bun.Glob("docker-compose*.{yml,yaml}");
  for await (const rel of composeGlob.scan({ cwd: root, onlyFiles: true })) {
    const text = await Bun.file(join(root, rel)).text();
    for (const s of parseComposeServices(text, rel)) {
      services.push({
        kind: "service",
        id: `svc:${s.composeFile}:${s.name}`,
        name: s.name,
        composeFile: rel,
        inject: s.envFiles.length ? "env_file" : "environment",
        envFileRef: s.envFiles[0],
      });
    }
  }

  // env files per app
  const usageByName = new Map<string, Set<string>>(); // name -> appIds
  const descByName = new Map<string, string>();
  const valuesByEnv: Record<string, Record<string, string>> = {};
  const envIds = new Set<string>();

  for (const app of apps) {
    const glob = new Bun.Glob(".env*");
    for await (const file of glob.scan({ cwd: join(root, app.path), onlyFiles: true, dot: true })) {
      if (file.endsWith(".example")) continue;
      const env = envIdForFile(file);
      envIds.add(env);
      app.envFiles[env] = file;
      const text = await Bun.file(join(root, app.path, file)).text();
      for (const e of parseDotenv(text)) {
        (usageByName.get(e.key) ?? usageByName.set(e.key, new Set()).get(e.key)!).add(app.id);
        if (e.description && !descByName.has(e.key)) descByName.set(e.key, e.description);
        (valuesByEnv[env] ??= {})[e.key] = e.value;
      }
    }
  }
  if (envIds.size === 0) envIds.add("dev");

  const variables: Variable[] = [];
  for (const [name, appIds] of usageByName) {
    const tier = appIds.size > 1 ? "global" : "local";
    const ownerApp = tier === "local" ? [...appIds][0] : undefined;
    variables.push({
      id: `var:${name}`,
      name,
      tier,
      ownerApp,
      description: descByName.get(name) ?? "",
      group: null,
      secret: /SECRET|TOKEN|KEY|PASSWORD|DSN|URL/i.test(name),
      consumers: [...appIds],
    });
  }

  const environments = [...envIds].sort().map((id, i) => ({ id, isDefault: id === "dev" || (i === 0 && !envIds.has("dev")) }));
  const consumers: Consumer[] = [...apps, ...services];

  const model: RepoModel = {
    root, environments, variables, consumers, values: {}, recipients: [],
  };
  return { model, valuesByEnv };
}
