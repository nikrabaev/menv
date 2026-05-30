# Conditional `.env.example`, Example Values & Value-Aware Sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `menv init`/generation create `.env.example` only for apps with a real env file, add an optional plaintext "example value" per variable (imported from existing `.env.example` files and emitted on regeneration), and make shared-variable detection value-aware — identical values across apps become one `global`, divergent values become per-app `local`s — which requires re-keying the encrypted value store by variable id.

**Architecture:** A thin Ink TUI over a headless core (`core`/`io`/`crypto`/`store`/`cli`/`ui`). Most new logic lands in `io/discovery.ts` (value-aware sharing + example import). The value store moves from name-keyed dotenv to id-keyed JSON across `crypto/vault.ts`, `store/save.ts`, `store/load.ts`, `cli/init.ts`.

**Tech Stack:** Bun, TypeScript, `bun test`. No new dependencies.

**Reference:** Spec at `docs/superpowers/specs/2026-05-30-env-examples-and-shared-values-design.md`.

**Conventions:** exact file paths; full code in every code step; run the test and confirm the stated expectation before moving on; commit at the end of each task. Run from repo root `/Users/nikrabaev/Work/personal/menv`. Branch: `env-examples-and-shared-values`. Baseline is 66 passing tests.

**Ordering note:** Tasks are ordered so the full suite stays green at every commit. Each task lists the test updates needed to keep prior tests passing.

---

## Task 1: Persist the optional `example` value through the manifest

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/io/persist.ts`
- Test: `tests/io/persist.test.ts`

- [ ] **Step 1: Add a failing test** — append to `tests/io/persist.test.ts`:

```ts
test("round-trips the optional example value", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:REDIS_URL", name: "REDIS_URL", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"], example: "redis://localhost:6379" },
      { id: "var:PORT", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
    ],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} }],
    values: {},
    recipients: [],
  };
  const { config, manifest } = modelToToml(m);
  const parts = tomlToModelParts(config, manifest);
  expect(parts.variables[0].example).toBe("redis://localhost:6379");
  expect(parts.variables[1].example).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/io/persist.test.ts`
Expected: FAIL — `example` is not on the `Variable` type / not persisted (`parts.variables[0].example` is `undefined`).

- [ ] **Step 3: Add the field to `src/core/types.ts`** — change the `Variable` interface to include `example`:

```ts
export interface Variable {
  id: VarId;
  name: string;
  tier: Tier;
  ownerApp?: AppId; // required iff tier === "local"
  description: string;
  group: string | null;
  secret: boolean;
  consumers: ConsumerId[]; // wiring; for local, includes owner app
  example?: string; // optional placeholder emitted into .env.example; one per variable, not per-env
}
```

- [ ] **Step 4: Persist it in `src/io/persist.ts`** — in `modelToToml`, the variables mapping becomes (adds `example`):

```ts
  const manifest = stringifyToml({
    variables: m.variables.map((v) => ({
      id: v.id, name: v.name, tier: v.tier, owner_app: v.ownerApp ?? "",
      description: v.description, group: v.group ?? "", secret: v.secret, consumers: v.consumers,
      example: v.example ?? "",
    })),
  });
```

  And in `tomlToModelParts`, the variables mapping becomes (adds `example`):

```ts
  const variables: Variable[] = ((man.variables ?? []) as any[]).map((v) => ({
    id: v.id, name: v.name, tier: v.tier, ownerApp: v.owner_app || undefined,
    description: v.description ?? "", group: v.group || null, secret: !!v.secret,
    consumers: v.consumers ?? [], example: v.example || undefined,
  }));
```

- [ ] **Step 5: Run the test to verify it passes, then the full suite**

Run: `bun test tests/io/persist.test.ts` → Expected: PASS.
Run: `bun test` → Expected: all green (67 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/io/persist.ts tests/io/persist.test.ts
git commit -m "feat(core): optional example value persisted in manifest"
```

---

## Task 2: Emit example values in `.env.example` and gate generation on a real env file

**Files:**
- Modify: `src/io/generate.ts`
- Test: `tests/io/generate.test.ts`
- Test: `tests/io/generate.disk.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/io/generate.test.ts`:

```ts
test("renderAppExample emits example values, empty when unset", () => {
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:REDIS_URL", name: "REDIS_URL", tier: "local", ownerApp: "app:api", description: "cache", group: null, secret: false, consumers: ["app:api"], example: "redis://localhost:6379" },
      { id: "var:PORT", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
    ],
    consumers: [],
    values: {},
    recipients: [],
  };
  const out = renderAppExample(m, "app:api");
  expect(out).toContain("REDIS_URL=redis://localhost:6379");
  expect(out).toContain("PORT=");
});
```

Append to `tests/io/generate.disk.test.ts`:

```ts
test("does not write .env.example for an app with no real env file", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "packages", "lib"), { recursive: true });
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [],
    consumers: [{ kind: "app", id: "app:lib", name: "lib", path: "packages/lib", envFiles: {} }],
    values: {},
    recipients: [],
  };
  const written = await writeGeneratedFiles(model, "ts1");
  expect(written).toEqual([]);
  expect(existsSync(join(root, "packages", "lib", ".env.example"))).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/io/generate.test.ts tests/io/generate.disk.test.ts`
Expected: FAIL — `renderAppExample` currently emits values-free `REDIS_URL=` (no example), and `writeGeneratedFiles` writes a `.env.example` even for the env-less app.

- [ ] **Step 3: Rewrite `src/io/generate.ts`** — replace the whole file with:

```ts
import { join, dirname } from "node:path";
import { mkdir, copyFile, rename } from "node:fs/promises";
import type { RepoModel } from "../core/types.ts";
import { varsForConsumer, valueOf } from "../core/model.ts";
import { serializeDotenv, type SerializeEntry } from "./dotenv.ts";

function sortedVars(model: RepoModel, consumerId: string) {
  return [...varsForConsumer(model, consumerId)].sort((a, b) => {
    const g = (a.group ?? "~").localeCompare(b.group ?? "~");
    return g !== 0 ? g : a.name.localeCompare(b.name);
  });
}

export function renderAppEnv(model: RepoModel, consumerId: string, env: string): string {
  const entries: SerializeEntry[] = sortedVars(model, consumerId).map((v) => ({
    key: v.name,
    value: valueOf(model, v.id, env),
    description: v.description,
    group: v.group,
  }));
  return serializeDotenv(entries, { groupHeaders: true });
}

export function renderAppExample(model: RepoModel, consumerId: string): string {
  const entries: SerializeEntry[] = sortedVars(model, consumerId).map((v) => ({
    key: v.name,
    value: v.example ?? "",
    description: v.description,
    group: v.group,
  }));
  return serializeDotenv(entries, { groupHeaders: true });
}

async function backupIfExists(root: string, rel: string, stamp: string): Promise<void> {
  const abs = join(root, rel);
  if (!(await Bun.file(abs).exists())) return;
  const dest = join(root, ".menv", "backups", stamp, rel);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(abs, dest);
}

async function writeFile(root: string, rel: string, content: string, stamp: string): Promise<string> {
  await backupIfExists(root, rel, stamp);
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = abs + ".menv-tmp";
  await Bun.write(tmp, content);
  await rename(tmp, abs);
  return rel;
}

export async function writeGeneratedFiles(model: RepoModel, stamp: string): Promise<string[]> {
  const written: string[] = [];
  for (const c of model.consumers) {
    if (c.kind !== "app") continue;
    for (const env of model.environments) {
      const filename = c.envFiles[env.id];
      if (!filename) continue;
      const rel = join(c.path, filename);
      written.push(await writeFile(model.root, rel, renderAppEnv(model, c.id, env.id), stamp));
    }
    if (Object.keys(c.envFiles).length > 0) {
      const exampleRel = join(c.path, ".env.example");
      written.push(await writeFile(model.root, exampleRel, renderAppExample(model, c.id), stamp));
    }
  }
  return written;
}
```

- [ ] **Step 4: Run the tests, then the full suite**

Run: `bun test tests/io/generate.test.ts tests/io/generate.disk.test.ts` → Expected: PASS.
Run: `bun test` → Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/io/generate.ts tests/io/generate.test.ts tests/io/generate.disk.test.ts
git commit -m "feat(io): example values in .env.example, gated on a real env file"
```

---

## Task 3: Store the vault as JSON (supports any key, including colon ids)

**Files:**
- Modify: `src/crypto/vault.ts`
- Test: `tests/crypto/vault.test.ts`

This is a pure storage-format change. `saveEnvValues`/`loadEnvValues` keep their `Record<string,string>` signatures; only the serialization changes from dotenv to JSON so that keys containing colons round-trip.

- [ ] **Step 1: Add a failing test** — append to `tests/crypto/vault.test.ts`:

```ts
test("round-trips id-style keys containing colons", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const { identity, recipient } = await generateKeypair();
  await saveEnvValues(root, "dev", { "var:app:api:NODE_ENV": "development", "var:app:web:NODE_ENV": "production" }, [recipient]);
  const got = await loadEnvValues(root, "dev", identity);
  expect(got).toEqual({ "var:app:api:NODE_ENV": "development", "var:app:web:NODE_ENV": "production" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/crypto/vault.test.ts`
Expected: FAIL — the dotenv serializer/parser drops keys with colons, so `got` is missing those entries.

- [ ] **Step 3: Rewrite `src/crypto/vault.ts`** — replace the whole file with:

```ts
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { encryptToRecipients, decryptWithIdentity } from "./age.ts";

function vaultPath(root: string, env: string): string {
  return join(root, ".menv", "values", `${env}.env.age`);
}

export async function saveEnvValues(
  root: string,
  env: string,
  values: Record<string, string>,
  recipients: string[],
): Promise<void> {
  const ct = await encryptToRecipients(JSON.stringify(values), recipients);
  await mkdir(join(root, ".menv", "values"), { recursive: true });
  await Bun.write(vaultPath(root, env), ct);
}

export async function loadEnvValues(
  root: string,
  env: string,
  identity: string,
): Promise<Record<string, string>> {
  const file = Bun.file(vaultPath(root, env));
  if (!(await file.exists())) return {};
  const ct = new Uint8Array(await file.arrayBuffer());
  const text = await decryptWithIdentity(ct, identity);
  return JSON.parse(text) as Record<string, string>;
}
```

- [ ] **Step 4: Run the test, then the full suite**

Run: `bun test tests/crypto/vault.test.ts` → Expected: PASS (3 tests; the two existing round-trip/empty tests still pass — JSON round-trips their keys).
Run: `bun test` → Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/crypto/vault.ts tests/crypto/vault.test.ts
git commit -m "feat(crypto): store vault as JSON to allow id-keyed values"
```

---

## Task 4: Key the value store by variable id (save + load)

**Files:**
- Modify: `src/store/save.ts`
- Modify: `src/store/load.ts`
- Test: `tests/store/save.test.ts`

- [ ] **Step 1: Update + add tests in `tests/store/save.test.ts`**

(a) Add this import near the top (alongside the existing imports):

```ts
import { loadRepo } from "../../src/store/load.ts";
```

(b) The vault is now keyed by variable id, so the existing assertion that reads the decrypted vault by name must read by id. The existing test's PORT variable has id `v1` — change:

```ts
  expect(vals.PORT).toBe("3000");
```

to:

```ts
  expect(vals["v1"]).toBe("3000");
```

(c) Append this round-trip test proving two same-named per-app locals survive:

```ts
test("save+load keep two same-named per-app locals with different values", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await mkdir(join(root, "apps", "web"), { recursive: true });
  const { identity, recipient } = await generateKeypair();
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:app:api:NODE_ENV", name: "NODE_ENV", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
      { id: "var:app:web:NODE_ENV", name: "NODE_ENV", tier: "local", ownerApp: "app:web", description: "", group: null, secret: false, consumers: ["app:web"] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: { dev: ".env" } },
      { kind: "app", id: "app:web", name: "web", path: "apps/web", envFiles: { dev: ".env" } },
    ],
    values: { "var:app:api:NODE_ENV": { dev: "development" }, "var:app:web:NODE_ENV": { dev: "production" } },
    recipients: [recipient],
  };
  await saveModel(model, "s1");
  const loaded = await loadRepo(root, identity);
  expect(loaded.values["var:app:api:NODE_ENV"].dev).toBe("development");
  expect(loaded.values["var:app:web:NODE_ENV"].dev).toBe("production");
  expect(await Bun.file(join(root, "apps", "api", ".env")).text()).toContain("NODE_ENV=development");
  expect(await Bun.file(join(root, "apps", "web", ".env")).text()).toContain("NODE_ENV=production");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/store/save.test.ts`
Expected: FAIL — `save.ts` still keys the vault by name, so `vals["v1"]` is undefined and the two NODE_ENV locals collide to a single name in the vault.

- [ ] **Step 3: Key by id in `src/store/save.ts`** — replace the `envValuesByName` helper and its call:

Replace the helper:

```ts
function envValuesById(model: RepoModel, env: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of model.variables) {
    const val = model.values[v.id]?.[env];
    if (val !== undefined) out[v.id] = val;
  }
  return out;
}
```

And in `saveModel`, replace the vault loop body line:

```ts
  for (const env of model.environments) {
    await saveEnvValues(model.root, env.id, envValuesById(model, env.id), model.recipients);
    files.push(`.menv/values/${env.id}.env.age`);
  }
```

- [ ] **Step 4: Map by id in `src/store/load.ts`** — replace `loadRepo` with:

```ts
export async function loadRepo(root: string, identity: string): Promise<RepoModel> {
  const parts = await readModelFiles(root);
  const ids = new Set(parts.variables.map((v) => v.id));
  const values: Values = {};
  for (const env of parts.environments) {
    const byId = await loadEnvValues(root, env.id, identity);
    for (const [id, val] of Object.entries(byId)) {
      if (!ids.has(id)) continue;
      (values[id] ??= {})[env.id] = val;
    }
  }
  return {
    root,
    environments: parts.environments,
    variables: parts.variables,
    consumers: parts.consumers,
    values,
    recipients: parts.recipients,
  };
}
```

Leave `isMenvRepo` unchanged. The `byName` map is gone; confirm no other code in the file references it.

- [ ] **Step 5: Run the test, then the full suite**

Run: `bun test tests/store/save.test.ts` → Expected: PASS.
Run: `bun test` → Expected: all green (`tests/store/load.test.ts` still passes — its model uses id `var:PORT`, which is exactly the vault key now).

- [ ] **Step 6: Commit**

```bash
git add src/store/save.ts src/store/load.ts tests/store/save.test.ts
git commit -m "feat(store): key the encrypted value store by variable id"
```

---

## Task 5: Value-aware sharing, per-app locals, and example import in discovery

**Files:**
- Modify: `src/io/discovery.ts`
- Modify: `src/cli/init.ts`
- Test: `tests/io/discovery.scan.test.ts` (rewritten)

`scanRepo` is rewritten to: detect sharing by value (global iff ≥2 apps agree; per-app locals on any disagreement), assign id-unique ids, populate `model.values` by id, import example values (and create example-only locals), and return `{ model }`. `init` drops its name→id remap.

- [ ] **Step 1: Replace `tests/io/discovery.scan.test.ts` entirely with:**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/io/discovery.scan.test.ts`
Expected: FAIL — `scanRepo` still returns `{ model, valuesByEnv }` with no per-app-local/example behavior; `model.values` is empty and the new assertions fail.

- [ ] **Step 3: Rewrite the second half of `src/io/discovery.ts`** — replace everything from the line `import { parseDotenv } from "./dotenv.ts";` (the second import block, ~line 48) through the end of the file with:

```ts
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
```

Notes for the implementer: `AppTarget`, `join`, `relative`, `dirname`, `parseYaml` are imported by the FIRST import block at the top of the file (unchanged) — do **not** re-import `AppTarget` here (it would duplicate). The new second import block adds `Values` and keeps `Consumer`/`RepoModel`/`ServiceTarget`/`Variable`. `detectApps` and its helpers (top of file) are unchanged.

- [ ] **Step 4: Simplify `src/cli/init.ts`** — replace `runInit` with (drops the name→id remap; values already live in `model.values`):

```ts
export async function runInit(root: string, opts: InitOpts = {}): Promise<void> {
  const { model } = await scanRepo(root);
  const kp = await loadOrCreateIdentity(opts.backend ?? keychainBackend);
  model.recipients = [kp.recipient];
  await saveModel(model, opts.stamp ?? `init-${model.environments[0]?.id ?? "dev"}`);
  await ensureGitignore(root);
}
```

Leave the `GITIGNORE_BLOCK`, `ensureGitignore`, and `InitOpts` parts of the file unchanged.

- [ ] **Step 5: Run the discovery test, then the full suite**

Run: `bun test tests/io/discovery.scan.test.ts` → Expected: PASS (3 tests).
Run: `bun test` → Expected: all green (`tests/cli/init.test.ts` and `tests/cli/generate.test.ts` still pass — a single-app `PORT` becomes `var:PORT`, saved and regenerated as before).

- [ ] **Step 6: Commit**

```bash
git add src/io/discovery.ts src/cli/init.ts tests/io/discovery.scan.test.ts
git commit -m "feat(io): value-aware sharing, per-app locals, and example import"
```

---

## Task 6: Update the design docs

**Files:**
- Modify: `docs/superpowers/specs/2026-05-30-menv-design.md`

- [ ] **Step 1: Update the two now-stale lines.**

In the on-disk layout / values section, the vault is no longer name-keyed dotenv. Find the line describing `dev.env.age` (currently `# encrypted values, one file per environment (ALL values)`) and change its trailing comment to note JSON-by-id:

```
│  │  ├─ dev.env.age          # encrypted values per environment (JSON keyed by variable id)
```

In the `.env.example` row of that same layout block, change:

```
└─ apps/web/.env.example      # GENERATED, committed (names + descriptions, no values)
```

to:

```
└─ apps/web/.env.example      # GENERATED for apps with a real .env; committed; example values
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-30-menv-design.md
git commit -m "docs: vault is JSON-by-id; .env.example is conditional + example-valued"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full suite**

Run: `bun test`
Expected: all green (~72 tests).

- [ ] **Step 2: Manual init smoke test** — proves the three behaviors end-to-end:

```bash
rm -rf /tmp/menv-ex && mkdir -p /tmp/menv-ex/apps/api /tmp/menv-ex/apps/web /tmp/menv-ex/packages/lib && cd /tmp/menv-ex
echo '{"name":"root","workspaces":["apps/*","packages/*"]}' > package.json
echo '{"name":"api"}' > apps/api/package.json
echo '{"name":"web"}' > apps/web/package.json
echo '{"name":"lib"}' > packages/lib/package.json
printf 'NODE_ENV=development\nDATABASE_URL=pg://a\n' > apps/api/.env
printf 'NODE_ENV=development\nWEB_PORT=3000\n' > apps/web/.env
printf 'DATABASE_URL=postgres://user:pass@localhost/db\nREDIS_URL=redis://localhost:6379\n' > apps/api/.env.example
bun run /Users/nikrabaev/Work/personal/menv/src/index.ts init
echo "--- api/.env.example (has example values) ---"; cat apps/api/.env.example
echo "--- web/.env.example (created, values-free) ---"; cat apps/web/.env.example
echo "--- lib has NO .env.example: ---"; ls packages/lib
echo "--- manifest shows NODE_ENV global, DATABASE_URL with example ---"; cat .menv/manifest.toml
```

Expected: `apps/api/.env.example` contains `DATABASE_URL=postgres://user:pass@localhost/db` and `REDIS_URL=redis://localhost:6379`; `apps/web/.env.example` exists with `NODE_ENV=` / `WEB_PORT=` (no example values); `packages/lib` has **no** `.env.example`; the manifest shows `NODE_ENV` as `tier = "global"` and `DATABASE_URL` carrying an `example`.

---

## Self-Review

**Spec coverage:**
- Feature A (conditional `.env.example`) → Task 2 (`writeGeneratedFiles` gate). ✅
- Feature B (example value: type, persist, emit, import) → Task 1 (type+persist), Task 2 (emit), Task 5 (import + example-only locals). ✅
- Feature C (value-aware sharing + per-app locals) → Task 5 (discovery rule + ids). ✅
- Value store re-keyed by id (JSON vault, save, load, init) → Task 3 (vault JSON), Task 4 (save/load by id), Task 5 (init). ✅
- Decisions D1–D5 → D1/D2 (Task 5 Phase 2: examples don't drive sharing, example-only→local), D3 (Task 5 conflict all-or-nothing via `appIds.length>=2 && !conflict`), D4 (Task 2 emits example for secrets too), D5 (Task 3 JSON). ✅
- Docs → Task 6. ✅

**Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output. ✅

**Type consistency:** `Variable.example?: string` defined in Task 1 is read by persist (Task 1), generate (Task 2), and written by discovery (Task 5). Vault `saveEnvValues`/`loadEnvValues` signatures unchanged (Task 3); `save.ts` `envValuesById` and `load.ts` id mapping use `v.id`/`Values` consistently (Task 4); `scanRepo` returns `{ model }` consumed by `init` (Task 5). Variable ids: `var:<NAME>` for global/single-local, `var:<appId>:<NAME>` for conflicted/example-only locals — used identically in discovery (Task 5) and the save/load round-trip test (Task 4). ✅

**Green-at-each-commit:** Each task lists the prior-test updates required (persist existing round-trip tolerates `example`; generate existing tests tolerate empty examples; vault existing tests round-trip via JSON; `save.test` name→id assertion updated in Task 4; `load.test`/`init.test`/`generate.test` unaffected). ✅
