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
import type { Consumer, RepoModel, ServiceTarget, Values, Variable } from "../core/types.ts";

function envIdForFile(filename: string): string {
  if (filename === ".env" || filename === ".env.local") return "dev";
  const m = /^\.env\.(.+)$/.exec(filename);
  if (!m || m[1] === "example") return "dev";
  return m[1];
}

const isSecretName = (name: string) => /SECRET|TOKEN|KEY|PASSWORD|DSN|URL/i.test(name);

export async function scanRepo(root: string): Promise<{ model: RepoModel }> {
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

  // Phase 1: real env files -> occurrences (name -> appId -> env -> value)
  const occ = new Map<string, Map<string, Map<string, string>>>();
  const descByName = new Map<string, string>();
  const envIds = new Set<string>();
  const exampleFiles: Array<{ app: AppTarget; file: string }> = [];

  for (const app of apps) {
    const glob = new Bun.Glob(".env*");
    for await (const file of glob.scan({ cwd: join(root, app.path), onlyFiles: true, dot: true })) {
      if (file.endsWith(".example")) {
        exampleFiles.push({ app, file });
        continue;
      }
      const env = envIdForFile(file);
      envIds.add(env);
      app.envFiles[env] = file;
      const text = await Bun.file(join(root, app.path, file)).text();
      for (const e of parseDotenv(text)) {
        const byApp = occ.get(e.key) ?? occ.set(e.key, new Map()).get(e.key)!;
        const byEnv = byApp.get(app.id) ?? byApp.set(app.id, new Map()).get(app.id)!;
        byEnv.set(env, e.value);
        if (e.description && !descByName.has(e.key)) descByName.set(e.key, e.description);
      }
    }
  }
  if (envIds.size === 0) envIds.add("dev");

  const variables: Variable[] = [];
  const values: Values = {};
  // varForAppName: appId -> name -> varId (which variable an app emits for a name)
  const varForAppName = new Map<string, Map<string, string>>();
  const remember = (appId: string, name: string, id: string) => {
    (varForAppName.get(appId) ?? varForAppName.set(appId, new Map()).get(appId)!).set(name, id);
  };

  // Ids: `var:<NAME>` for a global or a single-app local; `var:<appId>:<NAME>`
  // for conflicted/example-only locals. Variable names are `[A-Za-z0-9_]+`
  // (enforced by parseDotenv) and never contain ':', so the id segments stay
  // unambiguous and same-named per-app locals never collide.
  for (const [name, byApp] of occ) {
    const appIds = [...byApp.keys()];
    // conflict: in any env, two or more defining apps assign different values
    const distinctByEnv = new Map<string, Set<string>>();
    for (const [, byEnv] of byApp) {
      for (const [env, val] of byEnv) {
        (distinctByEnv.get(env) ?? distinctByEnv.set(env, new Set()).get(env)!).add(val);
      }
    }
    const conflict = [...distinctByEnv.values()].some((vals) => vals.size > 1);

    if (appIds.length >= 2 && !conflict) {
      const id = `var:${name}`;
      variables.push({
        id, name, tier: "global", description: descByName.get(name) ?? "",
        group: null, secret: isSecretName(name), consumers: appIds,
      });
      for (const [env, vals] of distinctByEnv) (values[id] ??= {})[env] = [...vals][0];
      for (const appId of appIds) remember(appId, name, id);
    } else {
      for (const appId of appIds) {
        const id = appIds.length === 1 ? `var:${name}` : `var:${appId}:${name}`;
        variables.push({
          id, name, tier: "local", ownerApp: appId, description: descByName.get(name) ?? "",
          group: null, secret: isSecretName(name), consumers: [appId],
        });
        for (const [env, val] of byApp.get(appId)!) (values[id] ??= {})[env] = val;
        remember(appId, name, id);
      }
    }
  }

  // Phase 2: example files -> example values + example-only locals
  for (const { app, file } of exampleFiles) {
    const text = await Bun.file(join(root, app.path, file)).text();
    for (const e of parseDotenv(text)) {
      const existingId = varForAppName.get(app.id)?.get(e.key);
      if (existingId) {
        const v = variables.find((x) => x.id === existingId)!;
        if (!v.example) v.example = e.value;
        if (!v.description && e.description) v.description = e.description;
      } else {
        // Example-only key: no real env file declared it. The owning app keeps an
        // empty envFiles, so writeGeneratedFiles intentionally skips its .env.example.
        const id = `var:${app.id}:${e.key}`;
        variables.push({
          id, name: e.key, tier: "local", ownerApp: app.id,
          description: e.description ?? "", group: null,
          secret: isSecretName(e.key), consumers: [app.id], example: e.value,
        });
        remember(app.id, e.key, id);
      }
    }
  }

  const environments = [...envIds].sort().map((id, i) => ({
    id, isDefault: id === "dev" || (i === 0 && !envIds.has("dev")),
  }));
  const consumers: Consumer[] = [...apps, ...services];

  return { model: { root, environments, variables, consumers, values, recipients: [] } };
}
