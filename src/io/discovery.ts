import { dirname, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AppTarget } from "../core/types.ts";

// Only the fields menv reads off a package.json; everything else is ignored.
interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

async function readJson(path: string): Promise<PackageJson | null> {
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
  const ws = (await readJson(join(root, "package.json")))?.workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws && Array.isArray(ws.packages)) return ws.packages;
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

import { freeVarId } from "../core/model.ts";
import type { Consumer, RepoModel, Values, Variable } from "../core/types.ts";
import { parseDotenv } from "./dotenv.ts";

// name -> consumerId -> env -> the parsed occurrence (value + whether it was a live
// line vs a commented-out one). `active: false` ⇒ the key was present as `# KEY=…`.
type Occurrence = { value: string; active: boolean };
type Occ = Map<string, Map<string, Map<string, Occurrence>>>;
// Per consumer, the set of environments it has a base file and a local file for.
// Used to tell "this var is absent from an env this consumer owns" (⇒ unapplied)
// apart from "this var simply has no value there".
type ConsumerFiles = Map<string, { base: Set<string>; local: Set<string> }>;

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
  occ: Occ,
  local: boolean,
  ctx: {
    variables: Variable[];
    values: Values;
    descByName: Map<string, string>;
    usedIds: Set<string>;
    filesByConsumer: ConsumerFiles;
    remember: (appId: string, name: string, id: string) => void;
  },
): void {
  for (const [name, byConsumer] of occ) {
    // Variable identity (and value-group splits) is decided by the env→value map
    // only; whether each occurrence was live or commented does not split a name.
    const sigOf = (cid: string) =>
      JSON.stringify(
        [...byConsumer.get(cid)!.entries()].map(([env, o]) => [env, o.value]).sort(([a], [b]) => `${a}`.localeCompare(`${b}`)),
      );
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
      // For each wired consumer, a var is unapplied in every env that consumer has
      // a file for where the key was absent or only present commented-out.
      const wiring = consumers.map((cid) => {
        const owned = ctx.filesByConsumer.get(cid)?.[local ? "local" : "base"] ?? new Set<string>();
        const here = byConsumer.get(cid)!;
        const unapplied = [...owned].filter((env) => here.get(env)?.active !== true).sort();
        return unapplied.length ? { consumer: cid, unapplied } : { consumer: cid };
      });
      ctx.variables.push({
        id, name, description: ctx.descByName.get(name) ?? "",
        group: null, secret: isSecretName(name), wiring,
        ...(local ? { local: true } : {}),
      });
      // Every member shares the same env→value map by construction; a commented
      // occurrence still carries its value so it round-trips on regeneration.
      for (const [env, o] of byConsumer.get(consumers[0]!)!) {
        ctx.values[id] ??= {};
        ctx.values[id][env] = o.value;
      }
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
  const occBase: Occ = new Map();
  const occLocal: Occ = new Map();
  const filesByConsumer: ConsumerFiles = new Map();
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
      // Record that this consumer owns a file for (env, locality) so a key missing
      // from it later reads as wired-but-unapplied rather than simply absent.
      const files = filesByConsumer.get(app.id) ?? filesByConsumer.set(app.id, { base: new Set(), local: new Set() }).get(app.id)!;
      (cls.local ? files.local : files.base).add(cls.env);
      const occ = cls.local ? occLocal : occBase;
      const text = await Bun.file(join(root, app.path, file)).text();
      for (const e of parseDotenv(text)) {
        const byApp = occ.get(e.key) ?? occ.set(e.key, new Map()).get(e.key)!;
        const byEnv = byApp.get(app.id) ?? byApp.set(app.id, new Map()).get(app.id)!;
        byEnv.set(cls.env, { value: e.value, active: e.active });
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
  const buildCtx = { variables, values, descByName, usedIds, filesByConsumer, remember };
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
        // Example-only key: no real env file declared it. Reaching this branch
        // means the key was absent from every base file this consumer owns, so
        // it is wired-but-unapplied in each of those envs (generated commented-
        // out) — the same rule buildVarsFromOcc applies to a key missing from
        // one of several env files. With no real env file at all (owned empty)
        // it stays applied-everywhere and surfaces only via `.env.example`.
        const owned = [...(filesByConsumer.get(app.id)?.base ?? [])].sort();
        const id = mintId(e.key);
        variables.push({
          id, name: e.key,
          description: e.description ?? "", group: null,
          secret: isSecretName(e.key),
          wiring: [owned.length ? { consumer: app.id, unapplied: owned } : { consumer: app.id }],
          example: e.value,
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
