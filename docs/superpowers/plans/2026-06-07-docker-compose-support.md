# Docker Compose Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let menv automatically keep a docker-compose service's `environment:` block in sync with a consumer's wiring, via marker comments, and generate the `.env.compose` file the service interpolates from.

**Architecture:** A compose service opts in with a `# <menv:NAME>` … `# </menv>` marker region inside its `environment:` block, naming an existing consumer. During generation menv (1) line-splices each region with `- KEY=${PREFIX_KEY}` entries for the consumer's applied variables, and (2) writes a git-ignored `.env.compose` per compose-project directory holding the always-consumer-prefixed values. All of this hangs off the existing `writeGeneratedFiles` chokepoint, so `menv generate`, every mutating CLI command, and TUI save get it for free. No manifest/`menv.toml` schema change — links are derived from the files on every run.

**Tech Stack:** Bun, TypeScript (strict, ESM with explicit `.ts` extensions, named exports only), `bun:test`. Reuses `src/core/model.ts` (`varsForConsumer`, `isApplied`, `resolveValue`) and `src/io/dotenv.ts` (`serializeDotenv`).

**Reference spec:** `docs/superpowers/specs/2026-06-07-docker-compose-support-design.md`

---

## File Structure

- **Create `src/io/atomicWrite.ts`** — `backupIfExists` + `writeFileWithBackup`, extracted verbatim from `src/io/generate.ts` so both the app-env and compose writers share one atomic-write-with-backup path (DRY). One responsibility: write a repo-relative file atomically, backing up any existing copy.
- **Modify `src/io/generate.ts`** — import the extracted writer instead of defining its own; call the new compose writer at the end of `writeGeneratedFiles`.
- **Create `src/io/compose.ts`** — all compose logic. Pure functions (`findRegions`, `prefixFor`, `detectStyle`, `renderRegionBody`, `spliceRegions`, `renderComposeEnv`) plus FS functions (`discoverComposeFiles`, `writeComposeFiles`). Parsing/rendering is FS-free for unit testing; only the two FS functions touch disk. Layering stays clean: this file imports `core/` and sibling `io/` modules only — never `cli/` — so it carries its own null-returning consumer resolver rather than reusing `cli/context.ts`'s throwing `resolveConsumer`.
- **Create `tests/io/compose.test.ts`** — pure-function unit tests (in-memory `RepoModel`, text fixtures).
- **Create `tests/io/compose.disk.test.ts`** — `discoverComposeFiles`, `writeComposeFiles`, and the `writeGeneratedFiles` integration, using `mkdtempSync`.
- **Modify `README.md`** — Concepts subsection, `generate` note, discovery rule, on-disk layout (required by CLAUDE.md when on-disk layout / discovery rules change).

---

## Task 1: Extract the atomic-write helper

**Files:**
- Create: `src/io/atomicWrite.ts`
- Modify: `src/io/generate.ts:1-61` (remove local `backupIfExists`/`writeFile`, import the extracted one)
- Test: existing `tests/io/generate.disk.test.ts` is the regression guard (no new test needed — pure refactor, behavior identical)

- [ ] **Step 1: Create the extracted module**

Create `src/io/atomicWrite.ts` with the exact bodies currently in `generate.ts`:

```ts
import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

// Copy an existing repo-relative file into .menv/backups/<stamp>/ before it is
// overwritten. A no-op when the file does not yet exist.
export async function backupIfExists(root: string, rel: string, stamp: string): Promise<void> {
  const abs = join(root, rel);
  if (!(await Bun.file(abs).exists())) return;
  const dest = join(root, ".menv", "backups", stamp, rel);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(abs, dest);
}

// Write `content` to repo-relative `rel` atomically (tmp file + rename), backing up
// any existing copy first. Returns `rel` so callers can collect written paths.
export async function writeFileWithBackup(root: string, rel: string, content: string, stamp: string): Promise<string> {
  await backupIfExists(root, rel, stamp);
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.menv-tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, abs);
  return rel;
}
```

- [ ] **Step 2: Point generate.ts at the extracted module**

In `src/io/generate.ts`: delete the local `backupIfExists` and `writeFile` function definitions (currently lines ~45-61) and the now-unused `copyFile, mkdir, rename` import (line 1). Keep `import { dirname, join } from "node:path";` only if still used (it is — `join` is used in the writer calls). Add at the top, alongside the other imports:

```ts
import { writeFileWithBackup as writeFile } from "./atomicWrite.ts";
```

The alias keeps every existing `writeFile(...)` call site in `writeGeneratedFiles` unchanged.

- [ ] **Step 3: Run the regression suite**

Run: `bun test tests/io/generate.disk.test.ts tests/io/generate.test.ts`
Expected: PASS (all existing generate tests green — behavior is unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/io/atomicWrite.ts src/io/generate.ts
git commit -m "refactor(io): extract atomic-write helper for reuse"
```

---

## Task 2: `findRegions` + `prefixFor`

**Files:**
- Create: `src/io/compose.ts`
- Test: `tests/io/compose.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/io/compose.test.ts`:

```ts
import { expect, test } from "bun:test";
import { findRegions, prefixFor } from "../../src/io/compose.ts";

test("findRegions captures token, indent, and line span", () => {
  const text = [
    "services:",
    "  api:",
    "    environment:",
    "      - NODE_ENV=production",
    "      # <menv:api>",
    "      - OLD=${API_OLD}",
    "      # </menv>",
  ].join("\n");
  const regions = findRegions(text);
  expect(regions).toHaveLength(1);
  expect(regions[0]!.token).toBe("api");
  expect(regions[0]!.indent).toBe("      ");
  expect(regions[0]!.open).toBe(4);
  expect(regions[0]!.close).toBe(6);
});

test("findRegions ignores an unterminated open marker", () => {
  const text = ["    # <menv:api>", "    - X=${API_X}"].join("\n");
  expect(findRegions(text)).toEqual([]);
});

test("findRegions tolerates an echoed name on the close tag and finds multiple regions", () => {
  const text = [
    "    # <menv:api>",
    "    # </menv:api>",
    "    # <menv:web>",
    "    # </menv>",
  ].join("\n");
  expect(findRegions(text).map((r) => r.token)).toEqual(["api", "web"]);
});

test("prefixFor uppercases and normalizes non-alphanumerics", () => {
  expect(prefixFor("api")).toBe("API");
  expect(prefixFor("web-admin")).toBe("WEB_ADMIN");
  expect(prefixFor("@acme/api")).toBe("ACME_API");
  expect(prefixFor("root")).toBe("ROOT");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/compose.test.ts`
Expected: FAIL with "Cannot find module '../../src/io/compose.ts'" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/io/compose.ts`:

```ts
const OPEN = /^(\s*)#\s*<menv:([^>]+)>\s*$/;
const CLOSE = /^\s*#\s*<\/menv(?::[^>]+)?>\s*$/;

export interface Region {
  token: string; // consumer token from the open marker
  indent: string; // leading whitespace of the open-marker line; reused for the body
  open: number; // line index of the open marker
  close: number; // line index of the close marker
}

// Find every `# <menv:NAME>` … `# </menv>` region. Regions do not nest; each open
// pairs with the nearest following close. An unterminated open is ignored.
export function findRegions(text: string): Region[] {
  const lines = text.split("\n");
  const regions: Region[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]!);
    if (!m) continue;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (CLOSE.test(lines[j]!)) {
        close = j;
        break;
      }
    }
    if (close === -1) continue;
    regions.push({ token: m[2]!.trim(), indent: m[1]!, open: i, close });
    i = close;
  }
  return regions;
}

// Derive the interpolation-key prefix for a consumer token: uppercased, every run
// of non-[A-Z0-9_] collapsed to a single "_", and leading/trailing "_" trimmed.
export function prefixFor(token: string): string {
  return token.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/compose.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/io/compose.ts tests/io/compose.test.ts
git commit -m "feat(compose): detect menv marker regions and derive key prefixes"
```

---

## Task 3: `detectStyle` + `renderRegionBody`

**Files:**
- Modify: `src/io/compose.ts`
- Test: `tests/io/compose.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/io/compose.test.ts`:

```ts
import { detectStyle, renderRegionBody } from "../../src/io/compose.ts";
import type { RepoModel } from "../../src/core/types.ts";

const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "", group: "DB", secret: true, wiring: [{ consumer: "app:api" }] },
    { id: "v2", name: "REDIS_URL", description: "", group: null, secret: false, wiring: [{ consumer: "app:api", unapplied: ["prod"] }] },
  ],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
  values: { v1: { dev: "pg://x", prod: "pg://p" }, v2: { dev: "redis://x", prod: "redis://p" } },
  recipients: [],
};

test("detectStyle reads sequence vs mapping from a sibling, defaulting to seq", () => {
  const seq = ["    environment:", "      - X=1", "      # <menv:api>", "      # </menv>"].join("\n");
  expect(detectStyle(seq.split("\n"), findRegions(seq)[0]!)).toBe("seq");
  const map = ["    environment:", "      X: 1", "      # <menv:api>", "      # </menv>"].join("\n");
  expect(detectStyle(map.split("\n"), findRegions(map)[0]!)).toBe("map");
  const empty = ["    environment:", "      # <menv:api>", "      # </menv>"].join("\n");
  expect(detectStyle(empty.split("\n"), findRegions(empty)[0]!)).toBe("seq");
});

test("renderRegionBody emits only applied vars, group-then-name sorted, with prefixed refs", () => {
  // dev: both applied → DB-group DATABASE_URL first, then REDIS_URL.
  expect(renderRegionBody(model, "app:api", "API", "dev", "seq")).toEqual([
    "- DATABASE_URL=${API_DATABASE_URL}",
    "- REDIS_URL=${API_REDIS_URL}",
  ]);
  // prod: REDIS_URL is unapplied → omitted entirely.
  expect(renderRegionBody(model, "app:api", "API", "prod", "seq")).toEqual([
    "- DATABASE_URL=${API_DATABASE_URL}",
  ]);
  // mapping style.
  expect(renderRegionBody(model, "app:api", "API", "dev", "map")).toEqual([
    "DATABASE_URL: ${API_DATABASE_URL}",
    "REDIS_URL: ${API_REDIS_URL}",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/compose.test.ts`
Expected: FAIL with "detectStyle is not a function" / "renderRegionBody is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/io/compose.ts` (add the imports at the top of the file):

```ts
import { isApplied, resolveValue, varsForConsumer } from "../core/model.ts";
import type { RepoModel, Variable } from "../core/types.ts";
```

```ts
const indentLen = (s: string) => /^\s*/.exec(s)![0]!.length;

// Classify a single line as a YAML sequence item, a mapping entry, or neither
// (blank/comment). Used to infer the style of the block a region sits in.
function classifyEntry(line: string): "seq" | "map" | null {
  const t = line.trimStart();
  if (t === "" || t.startsWith("#")) return null;
  if (t === "-" || t.startsWith("- ")) return "seq";
  if (/^[A-Za-z_][\w.-]*\s*:/.test(t)) return "map";
  return null;
}

// Infer whether the region's environment block is a sequence or a mapping: first
// from any entry already inside the region, then from the nearest sibling at the
// marker's indentation (scanning up, then down, stopping at a lower indent — i.e.
// the block boundary). Defaults to "seq" for an otherwise-empty block.
export function detectStyle(lines: string[], region: Region): "seq" | "map" {
  for (let i = region.open + 1; i < region.close; i++) {
    const c = classifyEntry(lines[i]!);
    if (c) return c;
  }
  const want = region.indent.length;
  const scan = (from: number, step: number, stop: (i: number) => boolean): "seq" | "map" | null => {
    for (let i = from; !stop(i); i += step) {
      const line = lines[i]!;
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      if (indentLen(line) < want) break; // left the environment block
      if (indentLen(line) === want) {
        const c = classifyEntry(line);
        if (c) return c;
      }
    }
    return null;
  };
  return scan(region.open - 1, -1, (i) => i < 0) ?? scan(region.close + 1, 1, (i) => i >= lines.length) ?? "seq";
}

// The base variables wired to `consumerId` and applied in `env`, group-then-name
// sorted. Local (.env.local) overrides never appear in a compose region.
function composeVars(model: RepoModel, consumerId: string, env: string): Variable[] {
  return varsForConsumer(model, consumerId)
    .filter((v) => !(v.local ?? false) && isApplied(v, consumerId, env))
    .sort((a, b) => (a.group ?? "~").localeCompare(b.group ?? "~") || a.name.localeCompare(b.name));
}

// The body lines for a region (no indentation; the splicer adds it). The container
// variable name stays on the left; the interpolation key is the prefixed name.
export function renderRegionBody(
  model: RepoModel,
  consumerId: string,
  prefix: string,
  env: string,
  style: "seq" | "map",
): string[] {
  return composeVars(model, consumerId, env).map((v) =>
    style === "map" ? `${v.name}: \${${prefix}_${v.name}}` : `- ${v.name}=\${${prefix}_${v.name}}`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/compose.test.ts`
Expected: PASS (all tests, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add src/io/compose.ts tests/io/compose.test.ts
git commit -m "feat(compose): detect block style and render region bodies"
```

---

## Task 4: `spliceRegions`

**Files:**
- Modify: `src/io/compose.ts`
- Test: `tests/io/compose.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/io/compose.test.ts`:

```ts
import { spliceRegions } from "../../src/io/compose.ts";

test("spliceRegions rewrites only the region body and preserves everything else", () => {
  const text = [
    "services:",
    "  api:",
    "    image: x",
    "    environment:",
    "      - NODE_ENV=production",
    "      # <menv:api>",
    "      - STALE=${API_STALE}",
    "      # </menv>",
    "    ports:",
    '      - "3000:3000"',
  ].join("\n");
  const { text: out, warnings, refs } = spliceRegions(text, model, "dev");
  expect(warnings).toEqual([]);
  expect(refs).toEqual([{ consumerId: "app:api", prefix: "API" }]);
  expect(out).toContain("      - DATABASE_URL=${API_DATABASE_URL}");
  expect(out).toContain("      - REDIS_URL=${API_REDIS_URL}");
  expect(out).not.toContain("STALE");
  // Untouched surroundings.
  expect(out).toContain("      - NODE_ENV=production");
  expect(out).toContain('      - "3000:3000"');
  expect(out).toContain("    image: x");
  // Markers themselves survive.
  expect(out).toContain("      # <menv:api>");
  expect(out).toContain("      # </menv>");
});

test("spliceRegions warns and leaves an unknown-consumer region untouched", () => {
  const text = ["    environment:", "      # <menv:ghost>", "      - X=${GHOST_X}", "      # </menv>"].join("\n");
  const { text: out, warnings, refs } = spliceRegions(text, model, "dev");
  expect(refs).toEqual([]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("ghost");
  expect(out).toBe(text); // unchanged
});

test("spliceRegions empties a region whose consumer has no applied vars", () => {
  const text = ["    environment:", "      # <menv:api>", "      - GONE=${API_GONE}", "      # </menv>"].join("\n");
  // prod with a model where api has nothing applied: reuse a var unapplied in prod.
  const m: RepoModel = {
    ...model,
    variables: [{ id: "v2", name: "REDIS_URL", description: "", group: null, secret: false, wiring: [{ consumer: "app:api", unapplied: ["prod"] }] }],
  };
  const { text: out } = spliceRegions(text, m, "prod");
  expect(out).toBe(["    environment:", "      # <menv:api>", "      # </menv>"].join("\n"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/compose.test.ts`
Expected: FAIL with "spliceRegions is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/io/compose.ts`:

```ts
// Resolve a marker token to a consumer id, or null (caller warns + skips). Mirrors
// cli/context.ts's resolveConsumer but returns null instead of throwing, and stays
// in the io layer (no cli import). Accepts a consumer id, an app name, or "root".
function resolveConsumerId(model: RepoModel, token: string): string | null {
  const byId = model.consumers.find((c) => c.id === token);
  if (byId) return byId.id;
  if (token === "root") {
    const r = model.consumers.find((c) => c.id === "root" || c.path === ".");
    if (r) return r.id;
  }
  const byName = model.consumers.filter((c) => c.name === token);
  return byName.length === 1 ? byName[0]!.id : null;
}

export interface SpliceResult {
  text: string;
  warnings: string[];
  refs: { consumerId: string; prefix: string }[]; // resolved consumers referenced here
}

// Rewrite every menv region in `text` for the active environment. Styles and
// consumer resolutions are computed against the pristine text, then bodies are
// spliced back-to-front so earlier line indices stay valid. Unknown-consumer
// regions are left untouched and reported in `warnings`.
export function spliceRegions(text: string, model: RepoModel, env: string): SpliceResult {
  const original = text.split("\n");
  const regions = findRegions(text);
  const plans = regions.map((region) => ({
    region,
    consumerId: resolveConsumerId(model, region.token),
    style: detectStyle(original, region),
  }));

  const lines = [...original];
  const warnings: string[] = [];
  const refs: { consumerId: string; prefix: string }[] = [];
  for (const { region, consumerId, style } of [...plans].reverse()) {
    if (!consumerId) {
      warnings.unshift(
        `menv: marker # <menv:${region.token}> names an unknown consumer — region left unchanged`,
      );
      continue;
    }
    const prefix = prefixFor(region.token);
    refs.unshift({ consumerId, prefix });
    const body = renderRegionBody(model, consumerId, prefix, env, style).map((l) => region.indent + l);
    lines.splice(region.open + 1, region.close - region.open - 1, ...body);
  }
  return { text: lines.join("\n"), warnings, refs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/compose.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/compose.ts tests/io/compose.test.ts
git commit -m "feat(compose): splice region bodies from consumer wiring"
```

---

## Task 5: `renderComposeEnv`

**Files:**
- Modify: `src/io/compose.ts`
- Test: `tests/io/compose.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/io/compose.test.ts`:

```ts
import { renderComposeEnv } from "../../src/io/compose.ts";

test("renderComposeEnv unions prefixed values, sorted, collision-free across consumers", () => {
  // Two consumers with a same-named but distinct DATABASE_URL variable.
  const m: RepoModel = {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "va", name: "DATABASE_URL", description: "", group: null, secret: true, wiring: [{ consumer: "app:api" }] },
      { id: "vw", name: "DATABASE_URL", description: "", group: null, secret: true, wiring: [{ consumer: "app:web" }] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" },
      { kind: "app", id: "app:web", name: "web", path: "apps/web", envFile: ".env" },
    ],
    values: { va: { dev: "pg://api" }, vw: { dev: "pg://web" } },
    recipients: [],
  };
  const out = renderComposeEnv(m, [
    { consumerId: "app:api", prefix: "API" },
    { consumerId: "app:web", prefix: "WEB" },
  ], "dev");
  expect(out).toBe("API_DATABASE_URL=pg://api\nWEB_DATABASE_URL=pg://web\n");
});

test("renderComposeEnv returns empty string when nothing is applied", () => {
  expect(renderComposeEnv(model, [], "dev")).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/compose.test.ts`
Expected: FAIL with "renderComposeEnv is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/io/compose.ts` (add the `dotenv` import at the top of the file):

```ts
import { type SerializeEntry, serializeDotenv } from "./dotenv.ts";
```

```ts
// The `.env.compose` body for a compose-project directory: the union of the
// referenced consumers' applied values, keyed by the prefixed interpolation name.
// Keys are always prefixed, so the union never collides; sorted for stable output.
export function renderComposeEnv(
  model: RepoModel,
  refs: { consumerId: string; prefix: string }[],
  env: string,
): string {
  const byKey = new Map<string, string>();
  for (const { consumerId, prefix } of refs) {
    for (const v of composeVars(model, consumerId, env)) {
      byKey.set(`${prefix}_${v.name}`, resolveValue(model, v.id, env));
    }
  }
  const entries: SerializeEntry[] = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value, description: "" }));
  return serializeDotenv(entries);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/compose.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/compose.ts tests/io/compose.test.ts
git commit -m "feat(compose): render the per-directory .env.compose body"
```

---

## Task 6: `discoverComposeFiles`

**Files:**
- Modify: `src/io/compose.ts`
- Test: `tests/io/compose.disk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/io/compose.disk.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverComposeFiles } from "../../src/io/compose.ts";

test("discoverComposeFiles finds conventional names and ignores node_modules/.git/.menv", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "infra"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, ".menv"), { recursive: true });
  await Bun.write(join(root, "docker-compose.yml"), "services: {}\n");
  await Bun.write(join(root, "docker-compose.prod.yaml"), "services: {}\n");
  await Bun.write(join(root, "infra", "compose.yml"), "services: {}\n");
  await Bun.write(join(root, "node_modules", "pkg", "docker-compose.yml"), "services: {}\n");
  await Bun.write(join(root, ".menv", "compose.yml"), "services: {}\n");

  const found = await discoverComposeFiles(root);
  expect(found).toEqual(["docker-compose.prod.yaml", "docker-compose.yml", "infra/compose.yml"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/compose.disk.test.ts`
Expected: FAIL with "discoverComposeFiles is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/io/compose.ts`:

```ts
const COMPOSE_GLOBS = [
  "**/docker-compose*.yml",
  "**/docker-compose*.yaml",
  "**/compose*.yml",
  "**/compose*.yaml",
];
const IGNORED_SEGMENTS = ["node_modules/", ".git/", ".menv/"];

// Repo-relative paths of every conventional compose file, excluding vendored and
// menv-internal directories. Sorted and de-duplicated across the glob families.
export async function discoverComposeFiles(root: string): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of COMPOSE_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
      if (IGNORED_SEGMENTS.some((seg) => rel.includes(seg))) continue;
      found.add(rel);
    }
  }
  return [...found].sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/compose.disk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/compose.ts tests/io/compose.disk.test.ts
git commit -m "feat(compose): discover conventional compose files"
```

---

## Task 7: `writeComposeFiles`

**Files:**
- Modify: `src/io/compose.ts`
- Test: `tests/io/compose.disk.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/io/compose.disk.test.ts`:

```ts
import { existsSync } from "node:fs";
import type { RepoModel } from "../../src/core/types.ts";
import { writeComposeFiles } from "../../src/io/compose.ts";

const apiModel = (root: string): RepoModel => ({
  root,
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "", group: null, secret: true, wiring: [{ consumer: "app:api" }] },
  ],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
  values: { v1: { dev: "pg://x" } },
  recipients: [],
});

test("writeComposeFiles fills the region and writes .env.compose beside the file", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const compose = [
    "services:",
    "  api:",
    "    environment:",
    "      # <menv:api>",
    "      # </menv>",
  ].join("\n");
  await Bun.write(join(root, "docker-compose.yml"), `${compose}\n`);

  const written = await writeComposeFiles(apiModel(root), "dev", "ts1");
  expect(written).toContain("docker-compose.yml");
  expect(written).toContain(".env.compose");

  const out = await Bun.file(join(root, "docker-compose.yml")).text();
  expect(out).toContain("      - DATABASE_URL=${API_DATABASE_URL}");
  expect(await Bun.file(join(root, ".env.compose")).text()).toBe("API_DATABASE_URL=pg://x\n");
});

test("writeComposeFiles leaves a marker-free compose file untouched and writes no .env.compose", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const compose = "services:\n  api:\n    environment:\n      - NODE_ENV=production\n";
  await Bun.write(join(root, "docker-compose.yml"), compose);

  const written = await writeComposeFiles(apiModel(root), "dev", "ts1");
  expect(written).toEqual([]);
  expect(await Bun.file(join(root, "docker-compose.yml")).text()).toBe(compose);
  expect(existsSync(join(root, ".env.compose"))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/compose.disk.test.ts`
Expected: FAIL with "writeComposeFiles is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/io/compose.ts` (add the path + writer imports at the top of the file):

```ts
import { dirname, join } from "node:path";
import { writeFileWithBackup } from "./atomicWrite.ts";
```

```ts
// Fill every menv region across all compose files and write each compose-project
// directory's `.env.compose`. Returns the repo-relative paths actually written.
// Marker-free files are skipped; a directory whose regions resolve to no applied
// values gets no stray `.env.compose`.
export async function writeComposeFiles(model: RepoModel, env: string, stamp: string): Promise<string[]> {
  const files = await discoverComposeFiles(model.root);
  const byDir = new Map<string, string[]>();
  for (const rel of files) {
    const dir = dirname(rel);
    (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(rel);
  }

  const written: string[] = [];
  for (const [dir, rels] of byDir) {
    const dirRefs: { consumerId: string; prefix: string }[] = [];
    for (const rel of rels) {
      const text = await Bun.file(join(model.root, rel)).text();
      if (findRegions(text).length === 0) continue; // no markers → never touch the file
      const { text: next, warnings, refs } = spliceRegions(text, model, env);
      for (const w of warnings) console.warn(w);
      dirRefs.push(...refs);
      if (next !== text) written.push(await writeFileWithBackup(model.root, rel, next, stamp));
    }
    if (dirRefs.length === 0) continue;
    const content = renderComposeEnv(model, dirRefs, env);
    if (content.trim() === "") continue;
    written.push(await writeFileWithBackup(model.root, join(dir, ".env.compose"), content, stamp));
  }
  return written;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/compose.disk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/compose.ts tests/io/compose.disk.test.ts
git commit -m "feat(compose): write filled compose files and .env.compose"
```

---

## Task 8: Hook into `writeGeneratedFiles`

**Files:**
- Modify: `src/io/generate.ts:69-110` (the `writeGeneratedFiles` function)
- Test: `tests/io/compose.disk.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/io/compose.disk.test.ts`:

```ts
import { writeGeneratedFiles } from "../../src/io/generate.ts";

test("writeGeneratedFiles fills compose regions and flips .env.compose by env", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const compose = "services:\n  api:\n    environment:\n      # <menv:api>\n      # </menv>\n";
  await Bun.write(join(root, "docker-compose.yml"), compose);
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: { v1: { dev: "3000", prod: "8080" } },
    recipients: [],
  };

  await writeGeneratedFiles(model, "dev", "ts1");
  expect(await Bun.file(join(root, "docker-compose.yml")).text()).toContain("      - PORT=${API_PORT}");
  expect(await Bun.file(join(root, ".env.compose")).text()).toBe("API_PORT=3000\n");

  await writeGeneratedFiles(model, "prod", "ts2");
  expect(await Bun.file(join(root, ".env.compose")).text()).toBe("API_PORT=8080\n");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/compose.disk.test.ts`
Expected: FAIL — `.env.compose` is not created (the hook does not exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/io/generate.ts`, add the import alongside the others at the top:

```ts
import { writeComposeFiles } from "./compose.ts";
```

In `writeGeneratedFiles`, immediately before `return written;` (currently line ~109), add:

```ts
  // Fill any docker-compose marker regions and write their .env.compose files.
  written.push(...(await writeComposeFiles(model, env, stamp)));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/compose.disk.test.ts tests/io/generate.disk.test.ts`
Expected: PASS (new integration test green; existing generate tests still green — no compose files in those fixtures, so the step is a no-op there).

- [ ] **Step 5: Commit**

```bash
git add src/io/generate.ts tests/io/compose.disk.test.ts
git commit -m "feat(compose): wire compose generation into writeGeneratedFiles"
```

---

## Task 9: README documentation

**Files:**
- Modify: `README.md` (Concepts section, CLI reference `generate` entry, on-disk layout block)

- [ ] **Step 1: Add the Docker Compose concept**

In `README.md`, in the **Concepts** list, add a new bullet after the **Drift reconciliation** bullet (around line 153):

```markdown
- **Docker Compose** — A compose service opts into menv by carrying a marker that
  names an existing consumer inside its `environment:` block:

  ```yaml
  services:
    api:
      environment:
        - NODE_ENV=production        # hand-authored, untouched
        # <menv:api>
        - DATABASE_URL=${API_DATABASE_URL}
        # </menv>
  ```

  menv fills the region with `- KEY=${CONSUMER_KEY}` for exactly the variables
  wired to that consumer and **applied** in the active environment — so
  `wire`/`unwire` reflects into every linked service on the next generate. The
  container variable name stays on the left; the interpolation key is always
  prefixed with the consumer name, so a single shared file never collides even
  when two services expose a same-named variable with different values. Lines
  outside the markers are never touched. Values come from a generated,
  git-ignored **`.env.compose`** beside the compose file (one per directory, the
  union of every region's values for the active environment). Run compose with
  `docker compose --env-file .env.compose …`; switch environments by
  regenerating (`menv generate --env prod`).
```

- [ ] **Step 2: Note it under `generate` in the CLI reference**

In the **CLI reference** block, extend the `generate` description (around line 281) so it reads:

```text
  generate [--env <env>]  Regenerate .env files from the vault (headless / CI),
                          fill docker-compose marker regions, and write each
                          compose directory's .env.compose. The password backend
                          reads MENV_PASSPHRASE.
```

- [ ] **Step 3: Show it in the on-disk layout**

In the **On-disk layout** tree (around line 314), add a compose example after the `apps/api/` block:

```text
├─ docker-compose.yml        # committed — menv fills `# <menv:NAME>` regions in services
├─ .env.compose              # git-ignored — generated interpolation values (per compose dir)
```

- [ ] **Step 4: Verify the docs build/read cleanly**

Run: `rg -n "env.compose|<menv:" README.md`
Expected: the new lines appear; no stray placeholders.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document docker-compose support"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `bun test`
Expected: PASS — all suites green, including the new `tests/io/compose.test.ts` and `tests/io/compose.disk.test.ts`.

- [ ] **Step 2: Lint and format check**

Run: `bun run lint`
Expected: no errors. If import-sort or format complains, run `bun run lint:fix` and re-run `bun test`.

- [ ] **Step 3: Smoke-test the binary path is unaffected**

Run: `bun run menv --help`
Expected: help text prints (the CLI still dispatches; no command was added or changed).

- [ ] **Step 4: Final commit if lint:fix changed anything**

```bash
git add -A
git commit -m "chore: lint/format for docker-compose support"
```

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Task |
|---|---|
| `# <menv:NAME>` … `# </menv>` markers, nearest-close, echoed-name tolerance | Task 2 (`findRegions`) |
| Always-prefix interpolation key (`${CONSUMER_KEY}`) | Task 2 (`prefixFor`), Task 3/5 |
| Container name on the left; sequence + mapping styles; default seq | Task 3 (`detectStyle`, `renderRegionBody`) |
| Omit unapplied vars; base vars only; group-then-name order | Task 3 (`composeVars`) |
| Line-based splice; preserve everything outside; indentation from marker | Task 4 (`spliceRegions`) |
| Unknown-consumer marker → non-fatal warning, region untouched | Task 4 |
| Per-directory `.env.compose`; union; prefixed; collision-free; active env | Task 5 (`renderComposeEnv`), Task 7 |
| Discovery glob; exclude node_modules/.git/.menv | Task 6 (`discoverComposeFiles`) |
| Marker-free files untouched; no stray empty `.env.compose` | Task 7 |
| Hook into `writeGeneratedFiles` (covers generate + save + TUI) | Task 8 |
| No manifest/`menv.toml` schema change | All — links are file-derived; no persist.ts change |
| `.env.compose` git-ignored | Existing `.env.*` rule — verified in README/layout, no gitignore change |
| README: concept, generate note, layout, discovery rule | Task 9 |
| Out of scope (drift-import, TUI link display, `compose` commands, per-env) | Intentionally omitted |

**2. Placeholder scan:** No TBD/TODO; every code and test step contains complete code; every command has expected output.

**3. Type consistency:** `Region` (token/indent/open/close), `SpliceResult` (text/warnings/refs), and the `{ consumerId; prefix }` ref shape are defined in Task 2/4 and used identically in Tasks 4/5/7. `renderRegionBody(model, consumerId, prefix, env, style)` and `renderComposeEnv(model, refs, env)` signatures match every call site. `writeFileWithBackup` (Task 1) is imported and called with the same `(root, rel, content, stamp)` shape in Task 7. `writeComposeFiles(model, env, stamp)` matches its call in Task 8.

**Note on warnings in the TUI:** `writeComposeFiles` emits unknown-consumer warnings via `console.warn`. During a TUI save this writes to stderr (Ink renders to stdout's alternate screen), so it is harmless if rarely visible. Surfacing these in the TUI is a deliberate fast-follow, consistent with the spec's out-of-scope list.
