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
      });
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

import { parseDotenv } from "./dotenv.ts";
import { freeVarId } from "../core/model.ts";
import type { Consumer, RepoModel, Values, Variable } from "../core/types.ts";

// What a `.env*` filename means: the `.env.example` template, or a values file
// carrying an environment id and a base/local flag. A `.local` suffix marks an
// override file (`.env.local`, `.env.<env>.local`) whose keys become `local`
// variables generated back into the matching `.local` file rather than the base.
type EnvFileClass =
  | { kind: "example" }
  | { kind: "env"; env: string; local: boolean };

function classifyEnvFile(filename: string): EnvFileClass | null {
  if (filename === ".env") return { kind: "env", env: "dev", local: false };
  if (filename === ".env.example") return { kind: "example" };
  if (filename === ".env.local") return { kind: "env", env: "dev", local: true };
  const m = /^\.env\.(.+)$/.exec(filename);
  if (!m) return null;
  let rest = m[1]!;
  let local = false;
  if (rest.endsWith(".local")) { local = true; rest = rest.slice(0, -".local".length); }
  if (rest === "" || rest === "example") return { kind: "example" };
  return { kind: "env", env: rest, local };
}

export const isSecretName = (name: string) => /SECRET|TOKEN|KEY|PASSWORD|DSN|URL/i.test(name);

// occ: name -> consumerId -> env -> value. Groups the consumers that define each
// name by value signature into variables (the majority group keeps the bare id),
// minting ids via the shared allocator. The base and local passes share one
// `usedIds` set so `var:NAME` and `var:NAME.local` never collide. `remember` is a
// no-op for the local pass — `.env.example` reconciliation matches base keys only.
function buildVarsFromOcc(
  occ: Map<string, Map<string, Map<string, string>>>,
  local: boolean,
  ctx: {
    variables: Variable[];
    values: Values;
    descByName: Map<string, string>;
    usedIds: Set<string>;
    remember: (appId: string, name: string, id: string) => void;
  },
): void {
  for (const [name, byConsumer] of occ) {
    const sigOf = (cid: string) =>
      JSON.stringify([...byConsumer.get(cid)!.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const groups = new Map<string, string[]>();
    for (const cid of byConsumer.keys()) {
      const sig = sigOf(cid);
      (groups.get(sig) ?? groups.set(sig, []).get(sig)!).push(cid);
    }
    const ordered = [...groups.values()].sort((a, b) =>
      b.length - a.length || [...a].sort()[0]!.localeCompare([...b].sort()[0]!),
    );
    for (const members of ordered) {
      const consumers = [...members].sort();
      const id = freeVarId(ctx.usedIds, name, { local });
      ctx.usedIds.add(id);
      ctx.variables.push({
        id, name, description: ctx.descByName.get(name) ?? "",
        group: null, secret: isSecretName(name), consumers,
        ...(local ? { local: true } : {}),
      });
      // Every member shares the same env→value map by construction.
      for (const [env, val] of byConsumer.get(consumers[0]!)!) (ctx.values[id] ??= {})[env] = val;
      for (const cid of consumers) ctx.remember(cid, name, id);
    }
  }
}

export async function scanRepo(root: string): Promise<{ model: RepoModel }> {
  const apps = await detectApps(root);

  // The repo root itself is always a wireable target: variables wired to "root"
  // are materialized into a top-level ./.env. Its envFile is always ".env" — a
  // stray empty file is avoided by generation skipping zero-wired consumers. If a
  // workspace glob already matched the root package.json, reuse that consumer
  // rather than adding a duplicate at the same path.
  const rootConsumer: AppTarget | null = apps.some((a) => a.path === ".")
    ? null
    : { kind: "app", id: "root", name: "root", path: ".", envFile: ".env" };
  const scanTargets = rootConsumer ? [...apps, rootConsumer] : apps;

  // Phase 1: real env files -> occurrences (name -> appId -> env -> value). Base
  // (`.env`/`.env.<env>`) and local (`.env.local`/`.env.<env>.local`) keys are
  // kept apart so a name appearing in both yields two variables (one flagged
  // `local`) generated into separate files.
  const occBase = new Map<string, Map<string, Map<string, string>>>();
  const occLocal = new Map<string, Map<string, Map<string, string>>>();
  const descByName = new Map<string, string>();
  const envIds = new Set<string>();
  const exampleFiles: Array<{ app: AppTarget; file: string }> = [];
  // Consumers that already keep an explicit `.env.<env>` file default to "perenv"
  // mode. The plain `.env` and its `.env.local` override stay "single".
  const perenvIds = new Set<string>();

  for (const app of scanTargets) {
    const glob = new Bun.Glob(".env*");
    for await (const file of glob.scan({ cwd: join(root, app.path), onlyFiles: true, dot: true })) {
      const cls = classifyEnvFile(file);
      if (!cls) continue;
      if (cls.kind === "example") {
        exampleFiles.push({ app, file });
        continue;
      }
      envIds.add(cls.env);
      // An explicit env suffix (anything but `.env` / `.env.local`) means the app
      // keeps per-env files → "perenv" mode.
      if (file !== ".env" && file !== ".env.local") perenvIds.add(app.id);
      // Existing env files seed the vault and mark the app for generation. Layout
      // (single ".env" vs per-env ".env.<env>") is decided by envMode below.
      app.envFile = ".env";
      const occ = cls.local ? occLocal : occBase;
      const text = await Bun.file(join(root, app.path, file)).text();
      for (const e of parseDotenv(text)) {
        const byApp = occ.get(e.key) ?? occ.set(e.key, new Map()).get(e.key)!;
        const byEnv = byApp.get(app.id) ?? byApp.set(app.id, new Map()).get(app.id)!;
        byEnv.set(cls.env, e.value);
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
  // Ids are minted via the shared allocator: `var:<NAME>` for the first value
  // group of a name, then `var:<NAME>#2`, `#3`, … for additional groups. Names
  // are `[A-Za-z0-9_]+` so `#` never collides.
  const usedIds = new Set<string>();
  const mintId = (name: string) => {
    const id = freeVarId(usedIds, name);
    usedIds.add(id);
    return id;
  };

  // Group the consumers that define each name by VALUE into variables (see
  // buildVarsFromOcc). The base pass feeds `varForAppName` so `.env.example`
  // reconciliation can find a base variable by name; the local pass does not.
  const buildCtx = { variables, values, descByName, usedIds, remember };
  buildVarsFromOcc(occBase, false, buildCtx);
  buildVarsFromOcc(occLocal, true, { ...buildCtx, remember: () => {} });

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
        // Example-only key: no real env file declared it. For a workspace app
        // this is harmless because its envFile stays undefined (generation skips
        // it); it surfaces only via `.env.example` once a value is added.
        const id = mintId(e.key);
        variables.push({
          id, name: e.key,
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
  const consumers: Consumer[] = scanTargets.map((c) => ({
    ...c,
    envMode: perenvIds.has(c.id) ? "perenv" : "single",
  }));

  return { model: { root, environments, variables, consumers, values, recipients: [] } };
}
