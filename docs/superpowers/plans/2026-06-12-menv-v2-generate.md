# menv v2 Generation & Verification Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the v2 spec: the generation pipeline (file strategies, disclaimer + ownership rule, interpolation-driven rendering, `.env.example`), compose marker filling + `.env.compose`, `menv generate`, `menv check`, `menv backup`/`restore`, `consumer remove --delete-files`/release, shell completions, and the README/CLAUDE.md/skill rewrite that lifts the v2-stale banners.

**Architecture:** A new `src/generate/` module owns everything about turning registry + vault values into files: `ownership.ts` (disclaimer header, marker detection/stripping), `render.ts` (pure env-file rendering), `paths.ts` (a consumer's generated paths — moved out of program.ts), `compose.ts` (pure line-based marker splicing; the `yaml` dep is unused and gets dropped), and `generate.ts` (the orchestrator producing a preview of `{path, content}` writes that the CLI applies or dry-runs). `executePlan` gains an optional `applyFileOp` callback so plan `FileOp`s become real disk work without core doing I/O. `check`, `backup`, `restore`, and `completions` are CLI modules on top.

**Tech Stack:** unchanged — Bun, strict TS (explicit `.ts` extensions, named exports), `bun:test`, commander v15, Biome.

---

## Prerequisites

- On branch `v2` with Plans 1–2 complete (HEAD at or after `9e73b41`), clean tree, `bun test` green (182 tests), `bun run lint` exit 0.
- Plan-2 APIs built on here (signatures in the repo are authoritative): `FileOp {action: "write"|"delete"|"release"; path}` and `executePlan(plan, ctx)` in `src/core/plan.ts` · `runMutation(root, registry, op, flags, io, sessions?, extras?, promptFn?)` + `MutationExtras {result?, pretty?}` + `openVaultSession`/`collectValueRecords` in `src/cli/run.ts` · `generatedPaths(def)` currently private in `src/cli/program.ts` (Task 4 moves it) · `expandAll/GlobalResolution` in `src/core/interpolate.ts` · `planConsumerRemove` in `src/core/ops/consumer.ts` · `upsertManagedBlock` in `src/io/gitignore.ts`.
- The README/CLAUDE.md rewrites happen ONLY in Task 11 — keep the stale banners until then.

## Scoping decisions (locked for this plan)

- **Ownership rule:** menv only overwrites/deletes a file whose FIRST line carries the ownership marker (or that it creates fresh). **Exception: registered compose files** — they are user-owned and menv rewrites only the lines between hand-authored `# <menv:name>` … `# </menv>` markers.
- **Staleness is judged against the header's recorded vault.** The disclaimer records which vault a file was generated from; `check` compares the file against a regeneration for *that* vault, so `menv generate --vault production` doesn't make every file "stale" relative to the default vault.
- **`consumer remove` emits NO dependency blockers — and the spec gets fixed, not the code.** References resolve strictly within one (vault, consumer) scope; removing a consumer removes whole scopes, so no *surviving* reference can break. The spec's removal table row claiming "broken-reference fallout" contradicts its own dependency-detection section; Task 6 corrects the spec table (this was the review panel's reconciliation request).
- **Missing values render as empty** (`NAME=`) plus a `MISSING_VALUE` warning — a wired-but-never-set variable is a legitimate intermediate state.
- **`generate` supports `--dry-run`** like every other mutating command: the pipeline always computes the full preview; dry-run just skips the writes.
- **Compose runs only on an unfiltered generate** (no `--consumer`); `--vault` selects the values. `compose bind` now also git-ignores the directory's `.env.compose`.
- **Finding severities in `check`:** errors (exit 1) — broken refs/cycles, unknown marker consumer, missing registered compose file, foreign file at an expected generated path, stale generated file, plaintext vault tracked by git, secret-bearing generated file tracked by git. Warnings — unopenable vault, missing value, orphaned key, registered compose file with no markers, git unavailable.
- **Completions are generated from the commander tree at runtime** (walking `program.commands`), so they cannot drift from the grammar by construction; the test still asserts every command and long flag appears.
- **The compiled binary cannot be executed on this machine** (it SIGKILLs — known environment limitation). Task 12 verifies the build via `strings` inspection and runs everything through `bun run`.

## File structure (what this plan creates/changes)

```text
src/
├─ generate/
│  ├─ ownership.ts        # marker constant, disclaimerHeader, hasOwnershipMarker, stripDisclaimer, headerVault
│  ├─ render.ts           # pure env/.env.example rendering (groups, disabled, secret split)
│  ├─ paths.ts            # consumerPaths(def) — moved from program.ts, + example path
│  ├─ compose.ts          # marker discovery, region splicing, compose entries, .env.compose rendering
│  └─ generate.ts         # vaultsNeeded, preview pipeline (targets → fetch → expand → render → ownership check)
├─ cli/
│  ├─ generate.ts         # runGenerate command handler
│  ├─ check.ts            # runCheck — findings engine
│  ├─ backupCmd.ts        # runBackup / runRestore handlers
│  └─ completions.ts      # emitZsh / emitBash from the Command tree
├─ io/backup.ts           # backupKey, collectBackupPaths, createBackup, listBackups, restoreBackup
├─ core/plan.ts           # MODIFIED: ExecuteContext.applyFileOp
├─ core/ops/consumer.ts   # MODIFIED: planConsumerRemove gains file ops (release|delete)
├─ cli/run.ts             # MODIFIED: MutationExtras.applyFileOp threaded into executePlan
├─ cli/program.ts         # MODIFIED: generate/check/backup/restore/completions commands,
│                         #   consumer remove --delete-files, compose bind gitignore, paths import
docs/superpowers/specs/2026-06-12-menv-v2-design.md   # MODIFIED: consumer-remove table row fix
README.md, CLAUDE.md, skills/menv-usage/SKILL.md      # REWRITTEN (Task 11)
package.json                                           # MODIFIED: drop unused yaml dep
tests/  (mirrors src/, fixtures via tests/helpers/fixtures.ts)
```

---

### Task 1: FileOp execution plumbing

**Files:**
- Modify: `src/core/plan.ts`, `src/cli/run.ts`
- Test: `tests/core/plan.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

In `tests/core/plan.test.ts`, extend `makePlan()`'s consumers — it already returns one `files` entry — and append inside `describe("executePlan", …)`:

```ts
  test("applyFileOp runs for each file op after vault ops, before commit", async () => {
    const log: string[] = [];
    await executePlan(makePlan(), {
      sessions: new Map([["local", fakeSession(log)]]),
      commitRegistry: async () => {
        log.push("commit-registry");
      },
      applyFileOp: async (op) => {
        log.push(`file ${op.action} ${op.path}`);
      },
    });
    expect(log).toEqual(["set k1=secret-value", "remove k2", "file write apps/api/.env", "commit-registry"]);
  });

  test("without applyFileOp, file ops remain descriptive only", async () => {
    const log: string[] = [];
    await executePlan(makePlan(), { sessions: new Map([["local", fakeSession(log)]]) });
    expect(log).toEqual(["set k1=secret-value", "remove k2"]); // unchanged Plan-2 behavior
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/core/plan.test.ts`
Expected: FAIL — `applyFileOp` is not a known property of `ExecuteContext` (TS error).

- [ ] **Step 3: Implement**

In `src/core/plan.ts`, extend `ExecuteContext` and the executor:

```ts
export interface ExecuteContext {
  force?: boolean;
  sessions: ReadonlyMap<string, VaultSession>;
  // Saves the already-computed next registry. Runs AFTER vault ops so the
  // committed registry never references a key whose write failed; a failed
  // run can leave orphan vault keys, which `menv check` reports.
  commitRegistry?: () => Promise<void>;
  // IO-bound file-op applier provided by the CLI (core does no I/O). Called
  // for each plan.files entry after vault ops, before commitRegistry. Absent
  // ⇒ file ops stay descriptive (rendered in plans, executed by nobody).
  applyFileOp?: (op: FileOp) => Promise<void>;
}
```

and in `executePlan`, replace the trailing comment block with:

```ts
  if (ctx.applyFileOp !== undefined) {
    for (const op of plan.files) await ctx.applyFileOp(op);
  }
  await ctx.commitRegistry?.();
```

(The existing `await ctx.commitRegistry?.();` line moves AFTER the new file-op loop; delete the old "plan.files is rendered for visibility today" comment.)

In `src/cli/run.ts`, thread it through: add to `MutationExtras`

```ts
export interface MutationExtras {
  result?: Record<string, unknown>; // merged into the JSON result
  pretty?: string; // appended to the pretty output
  // IO-bound applier for plan.files (release/delete/write). Skipped on dry-run
  // like everything else — executePlan is never called then.
  applyFileOp?: (op: FileOp) => Promise<void>;
}
```

with `import type { FileOp } from "../core/plan.ts";` added to the import block, and pass it in `runMutation`'s `executePlan` call:

```ts
    await executePlan(plan, {
      force: flags.force,
      sessions,
      commitRegistry: () => saveRegistry(root, next),
      applyFileOp: extras.applyFileOp,
    });
```

- [ ] **Step 4: Run the test, then the suite**

Run: `bun test tests/core/plan.test.ts` → 7 pass. Then `bun test` → all pass (184).

- [ ] **Step 5: Commit**

```bash
bun run lint:fix
git add src/core/plan.ts src/cli/run.ts tests/core/plan.test.ts
git commit -m "feat(core,cli): execute plan file ops via an injected applier

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Ownership module — disclaimer, marker, strip, recorded vault

**Files:**
- Create: `src/generate/ownership.ts`
- Test: `tests/generate/ownership.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/generate/ownership.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  OWNERSHIP_MARKER,
  disclaimerHeader,
  hasOwnershipMarker,
  headerVault,
  stripDisclaimer,
} from "../../src/generate/ownership.ts";

describe("disclaimerHeader", () => {
  test("is exactly three comment lines + one blank, starting with the marker", () => {
    const h = disclaimerHeader({ vault: "local", consumer: "api" });
    const lines = h.split("\n");
    expect(lines[0]?.startsWith(OWNERSHIP_MARKER)).toBe(true);
    expect(lines[1]).toContain("vault: local");
    expect(lines[1]).toContain("consumer: api");
    expect(lines[2]).toContain("menv generate");
    expect(lines[3]).toBe("");
    expect(lines).toHaveLength(4); // header ends with the blank separator
  });

  test("origin parts are optional", () => {
    expect(disclaimerHeader({}).split("\n")[1]).toBe("# Generated from menv.json");
  });
});

describe("hasOwnershipMarker / stripDisclaimer", () => {
  const body = "# ── Database ──\nDATABASE_URL=x\n";
  const owned = `${disclaimerHeader({ vault: "local", consumer: "api" })}\n${body}`;

  test("detects the marker only on the first line", () => {
    expect(hasOwnershipMarker(owned)).toBe(true);
    expect(hasOwnershipMarker(body)).toBe(false);
    expect(hasOwnershipMarker(`\n${owned}`)).toBe(false);
  });

  test("strip removes exactly the header, keeping group comments intact", () => {
    expect(stripDisclaimer(owned)).toBe(body);
    expect(stripDisclaimer(body)).toBe(body); // no marker → unchanged
  });
});

describe("headerVault", () => {
  test("reads the vault recorded in the header; undefined when absent", () => {
    expect(headerVault(disclaimerHeader({ vault: "production", consumer: "api" }))).toBe("production");
    expect(headerVault(disclaimerHeader({ consumer: "api" }))).toBeUndefined();
    expect(headerVault("FOO=bar\n")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/generate/ownership.test.ts`
Expected: FAIL — cannot resolve `src/generate/ownership.ts`.

- [ ] **Step 3: Implement**

Create `src/generate/ownership.ts`:

```ts
// The ownership rule (spec req 5): menv only overwrites or deletes a file
// whose FIRST line carries this marker. The header is structurally fixed —
// marker line, origin line, advice line, blank — so stripDisclaimer can remove
// exactly the header without eating the body's own comments (group headers).
export const OWNERSHIP_MARKER = "# ── managed by menv ─ DO NOT EDIT ─";
const HEADER_COMMENT_LINES = 3;

export interface HeaderMeta {
  vault?: string;
  consumer?: string;
}

export function disclaimerHeader(meta: HeaderMeta): string {
  const origin = [
    meta.vault !== undefined ? `vault: ${meta.vault}` : null,
    meta.consumer !== undefined ? `consumer: ${meta.consumer}` : null,
  ]
    .filter((p) => p !== null)
    .join(" · ");
  return [
    `${OWNERSHIP_MARKER}───────────────────────────`,
    `# Generated from menv.json${origin === "" ? "" : ` · ${origin}`}`,
    "# Re-create with `menv generate`; your edits will be overwritten.",
    "",
  ].join("\n");
}

export function hasOwnershipMarker(content: string): boolean {
  return content.startsWith(OWNERSHIP_MARKER);
}

// Removes exactly the header block (3 comment lines + the blank separator).
export function stripDisclaimer(content: string): string {
  if (!hasOwnershipMarker(content)) return content;
  const lines = content.split("\n");
  let i = HEADER_COMMENT_LINES;
  if (lines[i] === "") i += 1;
  return lines.slice(i).join("\n");
}

// Which vault a generated file was rendered from — `check` judges staleness
// against THIS vault, so generating --vault production doesn't flag the file
// as stale relative to the default vault.
export function headerVault(content: string): string | undefined {
  if (!hasOwnershipMarker(content)) return undefined;
  const origin = content.split("\n")[1] ?? "";
  const m = origin.match(/vault: ([^\s·]+)/);
  return m?.[1];
}
```

- [ ] **Step 4: Run the test, then the suite**

Run: `bun test tests/generate/ownership.test.ts` → 5 pass. Then `bun test` → all pass.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix
git add src/generate/ownership.ts tests/generate/ownership.test.ts
git commit -m "feat(generate): ownership marker, disclaimer header, strip, recorded vault

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure renderers

**Files:**
- Create: `src/generate/render.ts`
- Test: `tests/generate/render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/generate/render.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderEnvContent, renderExampleContent, splitSecrets } from "../../src/generate/render.ts";
import type { RenderEntry } from "../../src/generate/render.ts";

const HEADER = "# H\n";
const groups = { db: { title: "Database" }, app: { title: "App" } };

function entry(over: Partial<RenderEntry> & { name: string }): RenderEntry {
  return { value: "", disabled: false, secret: false, ...over };
}

describe("renderEnvContent", () => {
  test("groups in registry order with headers, ungrouped last, names sorted, disabled commented", () => {
    const out = renderEnvContent(
      [
        entry({ name: "ZED", value: "z" }),
        entry({ name: "DB_POOL", value: "10", groupKey: "db", disabled: true }),
        entry({ name: "DATABASE_URL", value: "postgres://x", groupKey: "db" }),
        entry({ name: "APP_NAME", value: "menv", groupKey: "app" }),
      ],
      groups,
      HEADER,
    );
    expect(out).toBe(
      "# H\n" +
        "# ── Database ──\n" +
        "DATABASE_URL=postgres://x\n" +
        "# DB_POOL=10\n" +
        "\n" +
        "# ── App ──\n" +
        "APP_NAME=menv\n" +
        "\n" +
        "ZED=z\n",
    );
  });

  test("empty entry list renders just the header", () => {
    expect(renderEnvContent([], groups, HEADER)).toBe("# H\n");
  });
});

describe("splitSecrets", () => {
  test("secret entries go to local when splitting is on; otherwise all stay main", () => {
    const entries = [entry({ name: "PUBLIC", value: "p" }), entry({ name: "TOKEN", value: "t", secret: true })];
    const split = splitSecrets(entries, true);
    expect(split.main.map((e) => e.name)).toEqual(["PUBLIC"]);
    expect(split.local.map((e) => e.name)).toEqual(["TOKEN"]);
    const noSplit = splitSecrets(entries, false);
    expect(noSplit.main).toHaveLength(2);
    expect(noSplit.local).toEqual([]);
  });
});

describe("renderExampleContent", () => {
  test("values-free template from the example field, disabled entries included plain", () => {
    const out = renderExampleContent(
      [
        entry({ name: "DATABASE_URL", value: "real-secret", groupKey: "db", example: "postgres://user:pass@host/db" }),
        entry({ name: "FLAG", value: "x", disabled: true }),
      ],
      groups,
      HEADER,
    );
    expect(out).toBe("# H\n# ── Database ──\nDATABASE_URL=postgres://user:pass@host/db\n\nFLAG=\n");
    expect(out).not.toContain("real-secret");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/generate/render.test.ts`
Expected: FAIL — cannot resolve `src/generate/render.ts`.

- [ ] **Step 3: Implement**

Create `src/generate/render.ts`:

```ts
import type { GroupDef } from "../registry/types.ts";

// Pure rendering: entries in, file text out. No I/O, no registry walking —
// the orchestrator (generate.ts) assembles RenderEntry lists per scope.
export interface RenderEntry {
  name: string;
  value: string; // already interpolation-expanded
  disabled: boolean;
  secret: boolean;
  groupKey?: string;
  example?: string;
}

type Groups = Record<string, GroupDef>;

// Sections: groups in registry order (only those present), ungrouped last.
function sections(entries: RenderEntry[], groups: Groups): { title: string | null; entries: RenderEntry[] }[] {
  const byName = (a: RenderEntry, b: RenderEntry) => a.name.localeCompare(b.name);
  const out: { title: string | null; entries: RenderEntry[] }[] = [];
  for (const [key, def] of Object.entries(groups)) {
    const members = entries.filter((e) => e.groupKey === key).sort(byName);
    if (members.length > 0) out.push({ title: def.title, entries: members });
  }
  const ungrouped = entries.filter((e) => e.groupKey === undefined || groups[e.groupKey] === undefined).sort(byName);
  if (ungrouped.length > 0) out.push({ title: null, entries: ungrouped });
  return out;
}

export function renderEnvContent(entries: RenderEntry[], groups: Groups, header: string): string {
  const blocks = sections(entries, groups).map(({ title, entries: members }) => {
    const lines = members.map((e) => (e.disabled ? `# ${e.name}=${e.value}` : `${e.name}=${e.value}`));
    return (title !== null ? [`# ── ${title} ──`, ...lines] : lines).join("\n");
  });
  return blocks.length > 0 ? `${header}${blocks.join("\n\n")}\n` : header;
}

export function splitSecrets(
  entries: RenderEntry[],
  secretsAsLocalOverrides: boolean,
): { main: RenderEntry[]; local: RenderEntry[] } {
  if (!secretsAsLocalOverrides) return { main: entries, local: [] };
  return { main: entries.filter((e) => !e.secret), local: entries.filter((e) => e.secret) };
}

// .env.example documents the full wired surface, values-free: every entry
// (disabled included) as NAME=<example or empty>, never commented.
export function renderExampleContent(entries: RenderEntry[], groups: Groups, header: string): string {
  const templated = entries.map((e) => ({ ...e, value: e.example ?? "", disabled: false }));
  return renderEnvContent(templated, groups, header);
}
```

- [ ] **Step 4: Run the test, then the suite**

Run: `bun test tests/generate/render.test.ts` → 4 pass. Then `bun test` → all pass.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix
git add src/generate/render.ts tests/generate/render.test.ts
git commit -m "feat(generate): pure env/.env.example renderers — groups, disabled, secret split

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Consumer paths module + generation orchestrator

**Files:**
- Create: `src/generate/paths.ts`, `src/generate/generate.ts`
- Modify: `src/cli/program.ts` (import paths from the new module)
- Test: `tests/generate/generate.disk.test.ts`

- [ ] **Step 1: Write the paths module (extracted from program.ts, + example path)**

Create `src/generate/paths.ts`:

```ts
import { join } from "node:path";
import type { ConsumerDef } from "../registry/types.ts";

// Every path a consumer's config implies. `local` companions exist only with
// secretsAsLocalOverrides; `example` only with strategyConfig.example.
export interface ConsumerPaths {
  main: string[];
  local: string[];
  example?: string;
}

export function consumerPaths(def: ConsumerDef): ConsumerPaths {
  const files =
    def.strategyType === "single" ? [def.strategyConfig.filename] : Object.values(def.strategyConfig.filenames);
  const base = def.strategyConfig.baseDir;
  const main = files.map((f) => join(base, f));
  const local = def.strategyConfig.secretsAsLocalOverrides === true ? main.map((p) => `${p}.local`) : [];
  return {
    main,
    local,
    ...(def.strategyConfig.example === true ? { example: join(base, ".env.example") } : {}),
  };
}

// The vault each generated env file draws values from.
export interface EnvTarget {
  consumer: string;
  vault: string;
  relPath: string;
  secretsSplit: boolean;
}

export function envTargets(
  consumers: Record<string, ConsumerDef>,
  defaults: { vault: string },
  opts: { vault?: string; consumer?: string },
): EnvTarget[] {
  const out: EnvTarget[] = [];
  for (const [name, def] of Object.entries(consumers)) {
    if (opts.consumer !== undefined && name !== opts.consumer) continue;
    const base = def.strategyConfig.baseDir;
    const split = def.strategyConfig.secretsAsLocalOverrides === true;
    if (def.strategyType === "single") {
      out.push({
        consumer: name,
        vault: opts.vault ?? defaults.vault,
        relPath: join(base, def.strategyConfig.filename),
        secretsSplit: split,
      });
    } else {
      for (const [vault, file] of Object.entries(def.strategyConfig.filenames)) {
        if (opts.vault !== undefined && vault !== opts.vault) continue;
        out.push({ consumer: name, vault, relPath: join(base, file), secretsSplit: split });
      }
    }
  }
  return out;
}
```

In `src/cli/program.ts`: delete the private `generatedPaths` function and replace its two call sites (consumer add / consumer update actions) using the new module:

```ts
import { consumerPaths } from "../generate/paths.ts";
```

and in both actions:

```ts
      if (!flags().dryRun) {
        const def = op.next.consumers[name];
        if (def !== undefined) {
          const paths = consumerPaths(def);
          const entries = o.gitignore === false ? paths.local : [...paths.main, ...paths.local];
          if (entries.length > 0) await upsertManagedBlock(root, entries);
        }
      }
```

(Behavior identical: `.env.example` is committed and intentionally NOT in the gitignore set.)

- [ ] **Step 2: Write the failing orchestrator test**

Create `tests/generate/generate.disk.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { hasOwnershipMarker } from "../../src/generate/ownership.ts";
import { previewGenerate, vaultsNeeded, applyPreview } from "../../src/generate/generate.ts";
import type { Registry } from "../../src/registry/types.ts";
import type { VaultSession } from "../../src/vault/provider.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const AUTH = { vaultAuth: {}, env: {} };

// One consumer with secrets split + example, one plain; values incl. a chain,
// a runtime global, a static global, a disabled entry, and a missing value.
async function fixture(): Promise<{ root: string; registry: Registry; sessions: Map<string, VaultSession> }> {
  const registry = makeRegistry();
  registry.consumers.web = {
    strategyType: "single",
    strategyConfig: { baseDir: "apps/web", filename: ".env", secretsAsLocalOverrides: true, example: true },
  };
  registry.groups = { db: { title: "Database" } };
  registry.globals.FQDN = {
    values: {
      local: { source: "static", value: "localhost:3000" },
      production: { source: "runtime" },
    },
  };
  registry.variables = {
    DATABASE_URL: {
      groupKey: "db",
      secret: true,
      example: "postgres://user:pass@host/db",
      vaultMapping: { local: { web: { key: "k-db" } }, production: { web: { key: "k-db-prod" } } },
    },
    PUBLIC_URL: { vaultMapping: { local: { web: { key: "k-url" } }, production: { web: { key: "k-url-prod" } } } },
    HEALTH_URL: { vaultMapping: { local: { web: { key: "k-health" } } } },
    FLAG: { vaultMapping: { local: { web: { key: "k-flag", disabled: true } } } },
    EMPTY: { vaultMapping: { local: { web: { key: "k-unset" } } } },
  };
  const root = await tmpRepo(registry);
  roots.push(root);
  const local = await openVaultSession(root, registry, "local", AUTH);
  await local.set("k-db", "postgres://localhost/app");
  await local.set("k-url", "https://${FQDN}/api");
  await local.set("k-health", "${PUBLIC_URL}/health");
  await local.set("k-flag", "on");
  const production = await openVaultSession(root, registry, "production", AUTH);
  await production.set("k-db-prod", "postgres://prod/app");
  await production.set("k-url-prod", "https://${FQDN}/api");
  const sessions = new Map<string, VaultSession>([
    ["local", local],
    ["production", production],
  ]);
  return { root, registry, sessions };
}

describe("previewGenerate + applyPreview", () => {
  test("renders main/.local/.env.example with interpolation and disabled lines", async () => {
    const { root, registry, sessions } = await fixture();
    const preview = await previewGenerate(root, registry, { consumer: "web" }, sessions);
    const byPath = new Map(preview.writes.map((w) => [w.path, w.content]));
    const main = byPath.get("apps/web/.env") as string;
    expect(hasOwnershipMarker(main)).toBe(true);
    expect(main).toContain("PUBLIC_URL=https://localhost:3000/api"); // static global expanded
    expect(main).toContain("HEALTH_URL=https://localhost:3000/api/health"); // chained
    expect(main).toContain("# FLAG=on"); // disabled → commented
    expect(main).toContain("EMPTY="); // missing value renders empty
    expect(main).not.toContain("DATABASE_URL"); // secret split out
    const local = byPath.get("apps/web/.env.local") as string;
    expect(local).toContain("# ── Database ──");
    expect(local).toContain("DATABASE_URL=postgres://localhost/app");
    const example = byPath.get("apps/web/.env.example") as string;
    expect(example).toContain("DATABASE_URL=postgres://user:pass@host/db");
    expect(example).not.toContain("postgres://localhost/app");
    expect(preview.warnings.some((w) => w.code === "MISSING_VALUE" && w.message.includes("EMPTY"))).toBe(true);
    await applyPreview(root, preview);
    expect(await Bun.file(join(root, "apps/web/.env")).text()).toBe(main);
  });

  test("--vault production: runtime global passes through literally", async () => {
    const { root, registry, sessions } = await fixture();
    const preview = await previewGenerate(root, registry, { consumer: "web", vault: "production" }, sessions);
    const main = preview.writes.find((w) => w.path === "apps/web/.env")?.content as string;
    expect(main).toContain("PUBLIC_URL=https://${FQDN}/api");
  });

  test("second run is unchanged; foreign file is refused, not overwritten", async () => {
    const { root, registry, sessions } = await fixture();
    await applyPreview(root, await previewGenerate(root, registry, { consumer: "web" }, sessions));
    const again = await previewGenerate(root, registry, { consumer: "web" }, sessions);
    expect(again.writes).toEqual([]);
    expect(again.unchanged).toContain("apps/web/.env");
    await Bun.write(join(root, "apps/web/.env"), "HAND=made\n"); // user takes ownership
    const third = await previewGenerate(root, registry, { consumer: "web" }, sessions);
    expect(third.refused).toContain("apps/web/.env");
    expect(third.writes.map((w) => w.path)).not.toContain("apps/web/.env");
    expect(await Bun.file(join(root, "apps/web/.env")).text()).toBe("HAND=made\n");
  });

  test("an interpolation cycle aborts with VALIDATION before anything is written", async () => {
    const { root, registry, sessions } = await fixture();
    const local = sessions.get("local") as VaultSession;
    await local.set("k-url", "${HEALTH_URL}"); // HEALTH_URL already references PUBLIC_URL
    try {
      await previewGenerate(root, registry, { consumer: "web" }, sessions);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect((e as MenvError).message).toContain("cycle");
    }
  });

  test("vaultsNeeded reflects targets", async () => {
    const { registry } = await fixture();
    expect(vaultsNeeded(registry, {}).sort()).toEqual(["local"]); // single consumers, default vault, no compose
    expect(vaultsNeeded(registry, { vault: "production" })).toEqual(["production"]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test tests/generate/generate.disk.test.ts`
Expected: FAIL — cannot resolve `src/generate/generate.ts`.

- [ ] **Step 4: Implement the orchestrator**

Create `src/generate/generate.ts`:

```ts
import { join } from "node:path";
import type { GlobalResolution } from "../core/interpolate.ts";
import { expandAll } from "../core/interpolate.ts";
import type { PlanIssue } from "../core/plan.ts";
import type { Registry } from "../registry/types.ts";
import { writeFileAtomic } from "../io/write.ts";
import type { VaultSession } from "../vault/provider.ts";
import { disclaimerHeader, hasOwnershipMarker } from "./ownership.ts";
import { renderEnvContent, renderExampleContent, splitSecrets } from "./render.ts";
import type { RenderEntry } from "./render.ts";
import { envTargets } from "./paths.ts";

export interface GenerateOpts {
  vault?: string;
  consumer?: string;
}

export interface GeneratePreview {
  writes: { path: string; content: string }[];
  unchanged: string[];
  refused: string[]; // existing files without the ownership marker
  warnings: PlanIssue[];
}

export function globalsFor(registry: Registry, vault: string): Map<string, GlobalResolution> {
  const out = new Map<string, GlobalResolution>();
  for (const [name, def] of Object.entries(registry.globals)) {
    const v = def.values[vault];
    if (v === undefined) continue;
    out.set(name, v.source === "static" ? { kind: "static", value: v.value } : { kind: "runtime" });
  }
  return out;
}

// Vaults a generate over these options will read from (env targets only;
// compose adds the selected vault, which envTargets already covers for
// single-mode consumers — the CLI unions in the compose vault when needed).
export function vaultsNeeded(registry: Registry, opts: GenerateOpts): string[] {
  return [...new Set(envTargets(registry.consumers, registry.defaults, opts).map((t) => t.vault))].sort();
}

// All wired entries for one (consumer, vault) scope, values fetched and
// interpolation-expanded. Missing values render empty + MISSING_VALUE warning.
export async function scopeEntries(
  registry: Registry,
  consumer: string,
  vault: string,
  session: VaultSession,
  warnings: PlanIssue[],
): Promise<RenderEntry[]> {
  const raw = new Map<string, string>();
  const meta: { name: string; disabled: boolean }[] = [];
  for (const [name, def] of Object.entries(registry.variables)) {
    const entry = def.vaultMapping[vault]?.[consumer];
    if (entry === undefined) continue;
    const value = await session.get(entry.key);
    if (value === undefined) {
      warnings.push({
        code: "MISSING_VALUE",
        message: `"${name}" has no value in vault "${vault}" (consumer "${consumer}") — rendered empty`,
      });
    }
    raw.set(name, value ?? "");
    meta.push({ name, disabled: entry.disabled === true });
  }
  const expanded = expandAll({ values: raw, globals: globalsFor(registry, vault) });
  return meta.map(({ name, disabled }) => {
    const def = registry.variables[name];
    return {
      name,
      value: expanded.get(name) ?? "",
      disabled,
      secret: def?.secret === true,
      groupKey: def?.groupKey,
      example: def?.example,
    };
  });
}

async function classify(
  root: string,
  path: string,
  content: string,
  preview: GeneratePreview,
): Promise<void> {
  const file = Bun.file(join(root, path));
  if (await file.exists()) {
    const existing = await file.text();
    if (existing === content) {
      preview.unchanged.push(path);
      return;
    }
    if (!hasOwnershipMarker(existing)) {
      preview.refused.push(path); // the user took ownership — never overwrite
      return;
    }
  }
  preview.writes.push({ path, content });
}

// Computes every file a generate would write. Pure-ish: reads vaults via the
// passed sessions and the disk only to classify (unchanged/refused). Throws
// VALIDATION (unresolved ref / cycle) before ANY write is possible.
export async function previewGenerate(
  root: string,
  registry: Registry,
  opts: GenerateOpts,
  sessions: ReadonlyMap<string, VaultSession>,
): Promise<GeneratePreview> {
  const preview: GeneratePreview = { writes: [], unchanged: [], refused: [], warnings: [] };
  const exampleDone = new Set<string>();
  for (const target of envTargets(registry.consumers, registry.defaults, opts)) {
    const session = sessions.get(target.vault);
    if (session === undefined) continue; // CLI opens all vaultsNeeded; defensive
    const entries = await scopeEntries(registry, target.consumer, target.vault, session, preview.warnings);
    const def = registry.consumers[target.consumer];
    if (def === undefined) continue;
    const header = disclaimerHeader({ vault: target.vault, consumer: target.consumer });
    const { main, local } = splitSecrets(entries, target.secretsSplit);
    await classify(root, target.relPath, renderEnvContent(main, registry.groups, header), preview);
    if (target.secretsSplit) {
      await classify(root, `${target.relPath}.local`, renderEnvContent(local, registry.groups, header), preview);
    }
    if (def.strategyConfig.example === true && !exampleDone.has(target.consumer)) {
      exampleDone.add(target.consumer);
      // The example documents the full wired surface across vaults: union of
      // names wired anywhere, values-free.
      const names = new Set<string>();
      for (const [name, v] of Object.entries(registry.variables)) {
        for (const byConsumer of Object.values(v.vaultMapping)) {
          if (byConsumer[target.consumer] !== undefined) names.add(name);
        }
      }
      const exampleEntries: RenderEntry[] = [...names].map((name) => {
        const v = registry.variables[name];
        return {
          name,
          value: "",
          disabled: false,
          secret: v?.secret === true,
          groupKey: v?.groupKey,
          example: v?.example,
        };
      });
      const examplePath = join(def.strategyConfig.baseDir, ".env.example");
      const exampleHeader = disclaimerHeader({ consumer: target.consumer });
      await classify(root, examplePath, renderExampleContent(exampleEntries, registry.groups, exampleHeader), preview);
    }
  }
  return preview;
}

export async function applyPreview(root: string, preview: GeneratePreview): Promise<void> {
  for (const w of preview.writes) await writeFileAtomic(root, w.path, w.content);
}
```

- [ ] **Step 5: Run the test, then the suite**

Run: `bun test tests/generate/generate.disk.test.ts` → 5 pass. Then `bun test` → all pass (program tests confirm the `consumerPaths` refactor kept gitignore behavior).

- [ ] **Step 6: Commit**

```bash
bun run lint:fix
git add src/generate tests/generate src/cli/program.ts
git commit -m "feat(generate): preview pipeline — targets, interpolation, ownership, examples

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Compose module

**Files:**
- Create: `src/generate/compose.ts`
- Test: `tests/generate/compose.disk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/generate/compose.disk.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { openVaultSession } from "../../src/cli/run.ts";
import { findMarkerRegions, previewCompose, spliceRegions } from "../../src/generate/compose.ts";
import type { Registry } from "../../src/registry/types.ts";
import type { VaultSession } from "../../src/vault/provider.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

describe("findMarkerRegions", () => {
  test("finds consumer regions with their indentation", () => {
    const yaml = "services:\n  api:\n    environment:\n      # <menv:api>\n      - OLD=1\n      # </menv>\n";
    const { regions, errors } = findMarkerRegions(yaml);
    expect(errors).toEqual([]);
    expect(regions).toEqual([{ consumer: "api", start: 3, end: 5, indent: "      " }]);
  });

  test("reports unclosed and nested markers", () => {
    expect(findMarkerRegions("# <menv:a>\n").errors[0]).toContain("unclosed");
    expect(findMarkerRegions("# <menv:a>\n# <menv:b>\n# </menv>\n").errors.some((e) => e.includes("nested"))).toBe(true);
    expect(findMarkerRegions("# </menv>\n").errors[0]).toContain("unmatched");
  });
});

describe("spliceRegions", () => {
  test("replaces region bodies, never touching lines outside the markers", () => {
    const yaml = "a: 1\n      # <menv:api>\n      - OLD=1\n      # </menv>\nb: 2\n";
    const { regions } = findMarkerRegions(yaml);
    const out = spliceRegions(yaml, regions, new Map([[3, ["      - NEW=${API_NEW}"]]]));
    expect(out).toBe("a: 1\n      # <menv:api>\n      - NEW=${API_NEW}\n      # </menv>\nb: 2\n");
  });
});

describe("previewCompose", () => {
  async function fixture(): Promise<{ root: string; registry: Registry; sessions: Map<string, VaultSession> }> {
    const registry = makeRegistry();
    registry.variables = {
      DATABASE_URL: { vaultMapping: { local: { api: { key: "k-db" } } } },
      FLAG: { vaultMapping: { local: { api: { key: "k-flag", disabled: true } } } },
    };
    registry.compose = { files: ["docker-compose.yml"] };
    const root = await tmpRepo(registry);
    roots.push(root);
    await Bun.write(
      join(root, "docker-compose.yml"),
      "services:\n  api:\n    environment:\n      - STATIC=keep\n      # <menv:api>\n      # </menv>\n",
    );
    const local = await openVaultSession(root, registry, "local", { vaultAuth: {}, env: {} });
    await local.set("k-db", "postgres://localhost/app");
    await local.set("k-flag", "on");
    return { root, registry, sessions: new Map([["local", local]]) };
  }

  test("fills the region, preserves hand lines, writes .env.compose (disabled commented)", async () => {
    const { root, registry, sessions } = await fixture();
    const preview = await previewCompose(root, registry, { vault: "local" }, sessions);
    const composed = preview.writes.find((w) => w.path === "docker-compose.yml")?.content as string;
    expect(composed).toContain("      - STATIC=keep"); // hand line untouched
    expect(composed).toContain("      - DATABASE_URL=${API_DATABASE_URL}");
    expect(composed).toContain("      - FLAG=${API_FLAG}"); // surface line present even when disabled
    const envCompose = preview.writes.find((w) => w.path === ".env.compose")?.content as string;
    expect(envCompose).toContain("API_DATABASE_URL=postgres://localhost/app");
    expect(envCompose).toContain("# API_FLAG=on"); // disabled value commented → interpolates empty
    expect(preview.errors).toEqual([]);
  });

  test("a marker naming an unknown consumer is an error", async () => {
    const { root, registry, sessions } = await fixture();
    await Bun.write(join(root, "docker-compose.yml"), "x:\n  # <menv:ghost>\n  # </menv>\n");
    const preview = await previewCompose(root, registry, { vault: "local" }, sessions);
    expect(preview.errors.some((e) => e.message.includes("ghost"))).toBe(true);
    expect(preview.writes).toEqual([]); // nothing written when a file has an error
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/generate/compose.disk.test.ts`
Expected: FAIL — cannot resolve `src/generate/compose.ts`.

- [ ] **Step 3: Implement**

Create `src/generate/compose.ts`:

```ts
import { dirname, join } from "node:path";
import { expandAll } from "../core/interpolate.ts";
import type { PlanIssue } from "../core/plan.ts";
import type { Registry } from "../registry/types.ts";
import type { VaultSession } from "../vault/provider.ts";
import { globalsFor } from "./generate.ts";
import { disclaimerHeader } from "./ownership.ts";

export interface MarkerRegion {
  consumer: string;
  start: number; // index of the opening `# <menv:consumer>` line
  end: number; // index of the closing `# </menv>` line
  indent: string; // leading whitespace of the opening marker
}

const OPEN_RE = /^(\s*)#\s*<menv:([a-z0-9][a-z0-9._-]*)>\s*$/;
const CLOSE_RE = /^\s*#\s*<\/menv>\s*$/;

// Markers are hand-authored by the user; menv only discovers them and rewrites
// the lines between each pair. Structural errors are reported, never fixed.
export function findMarkerRegions(content: string): { regions: MarkerRegion[]; errors: string[] } {
  const lines = content.split("\n");
  const regions: MarkerRegion[] = [];
  const errors: string[] = [];
  let open: { consumer: string; start: number; indent: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const openM = line.match(OPEN_RE);
    if (openM) {
      if (open !== null) errors.push(`nested menv marker at line ${i + 1}`);
      open = { consumer: openM[2] as string, start: i, indent: openM[1] as string };
      continue;
    }
    if (CLOSE_RE.test(line)) {
      if (open === null) {
        errors.push(`unmatched </menv> at line ${i + 1}`);
        continue;
      }
      regions.push({ consumer: open.consumer, start: open.start, end: i, indent: open.indent });
      open = null;
    }
  }
  if (open !== null) errors.push(`unclosed <menv:${open.consumer}> marker`);
  return { regions, errors };
}

// Replaces each region's body (the lines strictly between its markers) with the
// supplied fill lines, keyed by the region's start index. Lines outside every
// region — including the marker lines themselves — are preserved verbatim.
export function spliceRegions(content: string, regions: MarkerRegion[], fillByStart: Map<number, string[]>): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  const byStart = new Map(regions.map((r) => [r.start, r]));
  while (i < lines.length) {
    const region = byStart.get(i);
    if (region !== undefined) {
      out.push(lines[i] as string); // opening marker
      out.push(...(fillByStart.get(region.start) ?? []));
      out.push(lines[region.end] as string); // closing marker
      i = region.end + 1;
      continue;
    }
    out.push(lines[i] as string);
    i += 1;
  }
  return out.join("\n");
}

// The interpolation key for a (consumer, variable): consumer-prefixed so two
// services sharing one .env.compose never collide.
export function composeKey(consumer: string, name: string): string {
  return `${consumer.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${name}`;
}

interface ComposeValue {
  key: string;
  value: string;
  disabled: boolean;
}

export interface ComposePreview {
  writes: { path: string; content: string }[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
}

// One compose pass over every registered file for the selected vault. Each
// file's marker regions are filled and a sibling .env.compose (the union of
// every region's values, disabled commented) is rendered.
export async function previewCompose(
  root: string,
  registry: Registry,
  opts: { vault?: string },
  sessions: ReadonlyMap<string, VaultSession>,
): Promise<ComposePreview> {
  const vault = opts.vault ?? registry.defaults.vault;
  const preview: ComposePreview = { writes: [], errors: [], warnings: [] };
  const session = sessions.get(vault);
  const globals = globalsFor(registry, vault);
  // Group compose files by directory so one .env.compose serves all files there.
  const valuesByDir = new Map<string, Map<string, ComposeValue>>();
  const splicedWrites: { path: string; content: string }[] = [];

  for (const file of registry.compose.files) {
    const abs = Bun.file(join(root, file));
    if (!(await abs.exists())) {
      preview.errors.push({ code: "MISSING_COMPOSE_FILE", message: `registered compose file not found: ${file}` });
      continue;
    }
    const content = await abs.text();
    const { regions, errors } = findMarkerRegions(content);
    for (const e of errors) preview.errors.push({ code: "COMPOSE_MARKER", message: `${file}: ${e}` });
    if (errors.length > 0) continue;
    if (regions.length === 0) {
      preview.warnings.push({ code: "COMPOSE_NO_MARKERS", message: `${file}: bound but has no menv markers` });
    }
    const dir = dirname(file) === "." ? "" : dirname(file);
    const dirValues = valuesByDir.get(dir) ?? new Map<string, ComposeValue>();
    valuesByDir.set(dir, dirValues);
    const fillByStart = new Map<number, string[]>();
    let fileFailed = false;
    for (const region of regions) {
      if (registry.consumers[region.consumer] === undefined) {
        preview.errors.push({
          code: "COMPOSE_UNKNOWN_CONSUMER",
          message: `${file}: marker names unknown consumer "${region.consumer}"`,
        });
        fileFailed = true;
        continue;
      }
      if (session === undefined) {
        preview.warnings.push({ code: "UNVERIFIED_VAULT", message: `vault "${vault}" could not be opened for compose` });
        fileFailed = true;
        continue;
      }
      const raw = new Map<string, string>();
      const meta: { name: string; disabled: boolean }[] = [];
      const names = Object.keys(registry.variables)
        .filter((n) => registry.variables[n]?.vaultMapping[vault]?.[region.consumer] !== undefined)
        .sort();
      for (const name of names) {
        const entry = registry.variables[name]?.vaultMapping[vault]?.[region.consumer];
        if (entry === undefined) continue;
        raw.set(name, (await session.get(entry.key)) ?? "");
        meta.push({ name, disabled: entry.disabled === true });
      }
      const expanded = expandAll({ values: raw, globals });
      const fill: string[] = [];
      for (const { name, disabled } of meta) {
        const key = composeKey(region.consumer, name);
        fill.push(`${region.indent}- ${name}=\${${key}}`);
        dirValues.set(key, { key, value: expanded.get(name) ?? "", disabled });
      }
      fillByStart.set(region.start, fill);
    }
    if (fileFailed) continue;
    splicedWrites.push({ path: file, content: spliceRegions(content, regions, fillByStart) });
  }

  if (preview.errors.length > 0) return { ...preview, writes: [] };
  preview.writes.push(...splicedWrites);
  for (const [dir, values] of valuesByDir) {
    const header = disclaimerHeader({ vault });
    const lines = [...values.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((v) => (v.disabled ? `# ${v.key}=${v.value}` : `${v.key}=${v.value}`));
    preview.writes.push({ path: join(dir, ".env.compose"), content: `${header}${lines.join("\n")}\n` });
  }
  return preview;
}
```

- [ ] **Step 4: Run the test, then the suite**

Run: `bun test tests/generate/compose.disk.test.ts` → 5 pass. Then `bun test` → all pass.

- [ ] **Step 5: Commit**

```bash
bun run lint:fix
git add src/generate/compose.ts tests/generate/compose.disk.test.ts
git commit -m "feat(generate): compose marker splicing and .env.compose rendering

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: consumer remove file ops + applier + spec fix

**Files:**
- Modify: `src/core/ops/consumer.ts`, `src/cli/program.ts`, `docs/superpowers/specs/2026-06-12-menv-v2-design.md`
- Create: `src/generate/apply.ts`
- Test: `tests/core/ops/consumer.test.ts` (extend), `tests/generate/apply.disk.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("planConsumerRemove", …)` in `tests/core/ops/consumer.test.ts`:

```ts
  test("default mode emits release file ops; --delete-files emits delete ops", () => {
    const r = makeRegistry();
    const paths = ["apps/api/.env", "apps/api/.env.local"];
    const released = planConsumerRemove(r, { name: "api", openable: new Set(), paths, deleteFiles: false });
    expect(released.plan.files).toEqual([
      { action: "release", path: "apps/api/.env" },
      { action: "release", path: "apps/api/.env.local" },
    ]);
    const deleted = planConsumerRemove(r, { name: "api", openable: new Set(), paths, deleteFiles: true });
    expect(deleted.plan.files.every((f) => f.action === "delete")).toBe(true);
  });
```

Create `tests/generate/apply.disk.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFileOp } from "../../src/generate/apply.ts";
import { disclaimerHeader } from "../../src/generate/ownership.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-apply-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const owned = `${disclaimerHeader({ vault: "local", consumer: "api" })}\nA=1\n`;

describe("applyFileOp", () => {
  test("release strips the disclaimer from an owned file", async () => {
    await Bun.write(join(root, "apps/api/.env"), owned);
    await applyFileOp(root, { action: "release", path: "apps/api/.env" });
    expect(await Bun.file(join(root, "apps/api/.env")).text()).toBe("A=1\n");
  });

  test("delete removes an owned file", async () => {
    await Bun.write(join(root, "f.env"), owned);
    await applyFileOp(root, { action: "delete", path: "f.env" });
    expect(await Bun.file(join(root, "f.env")).exists()).toBe(false);
  });

  test("a user-owned (unmarked) file is never touched", async () => {
    await Bun.write(join(root, "f.env"), "HAND=made\n");
    await applyFileOp(root, { action: "release", path: "f.env" });
    await applyFileOp(root, { action: "delete", path: "f.env" });
    expect(await Bun.file(join(root, "f.env")).text()).toBe("HAND=made\n");
  });

  test("a missing file is a no-op", async () => {
    await applyFileOp(root, { action: "delete", path: "nope.env" });
    expect(await Bun.file(join(root, "nope.env")).exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test tests/generate/apply.disk.test.ts tests/core/ops/consumer.test.ts`
Expected: FAIL — cannot resolve `src/generate/apply.ts`; `planConsumerRemove` rejects the new `paths`/`deleteFiles` input.

- [ ] **Step 3: Implement the applier**

Create `src/generate/apply.ts`:

```ts
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileOp } from "../core/plan.ts";
import { writeFileAtomic } from "../io/write.ts";
import { hasOwnershipMarker, stripDisclaimer } from "./ownership.ts";

// Applies a release/delete file op under the ownership rule: a file without the
// marker (the user took it over) or a missing file is left untouched. `write`
// ops are applied by applyPreview, which already carries the content.
export async function applyFileOp(root: string, op: FileOp): Promise<void> {
  if (op.action === "write") return;
  const abs = join(root, op.path);
  const file = Bun.file(abs);
  if (!(await file.exists())) return;
  if (!hasOwnershipMarker(await file.text())) return;
  if (op.action === "release") {
    await writeFileAtomic(root, op.path, stripDisclaimer(await file.text()));
  } else {
    await rm(abs);
  }
}
```

- [ ] **Step 4: Extend planConsumerRemove**

In `src/core/ops/consumer.ts`, change the input interface and append file ops:

```ts
export interface ConsumerRemoveInput {
  name: string;
  // Vaults a session could be opened for; orphaned keys elsewhere become a
  // warning (Plan 3's `check` reports lingering keys), never a blocker.
  openable: Set<string>;
  // The consumer's generated paths (main + .local + .env.example), computed by
  // the caller via consumerPaths. Released (disclaimer stripped) by default, or
  // deleted with --delete-files. Marker-guarded at apply time. OPTIONAL so the
  // Plan-2 unit tests (registry cascade only) keep calling without them.
  paths?: string[];
  deleteFiles?: boolean;
}
```

and at the END of `planConsumerRemove`, before `return { next, plan };`, add:

```ts
  for (const path of input.paths ?? []) {
    plan.files.push({ action: input.deleteFiles === true ? "delete" : "release", path });
  }
```

(Orphaned compose markers naming the removed consumer are intentionally left for `menv check` to report — menv never structurally edits a user-owned compose file during an unrelated registry op. This is the spec correction below.)

- [ ] **Step 5: Update the program.ts handler**

In `src/cli/program.ts`, replace the `consumer.command("remove …")` action:

```ts
  consumer
    .command("remove <name>")
    .option("--delete-files", "delete the consumer's generated files instead of releasing them")
    .action(async (name, o) => {
      const registry = await reg();
      const def = registry.consumers[name];
      const paths = def !== undefined ? (() => { const p = consumerPaths(def); return [...p.main, ...p.local, ...(p.example !== undefined ? [p.example] : [])]; })() : [];
      const wired = vaultsWiring(registry, (_v, c) => c === name);
      const scan = await collectValueRecords(root, registry, wired, flags(), prompt);
      const op = planConsumerRemove(registry, { name, openable: scan.openable, paths, deleteFiles: o.deleteFiles === true });
      await runMutation(root, registry, op, flags(), io, scan.sessions, { applyFileOp: (fop) => applyFileOp(root, fop) }, prompt);
    });
```

and add the import:

```ts
import { applyFileOp } from "../generate/apply.ts";
```

- [ ] **Step 6: Fix the spec's removal table**

In `docs/superpowers/specs/2026-06-12-menv-v2-design.md`, the `consumer remove` row of the "Referential integrity on removal" table currently reads:

```
| `consumer remove` | Releases files (strips disclaimers); blocked only by broken-reference fallout | `--delete-files` deletes generated files; `--force` overrides reference blockers |
```

Replace it with:

```
| `consumer remove` | Releases files (strips disclaimers). No reference blockers: refs resolve within one (vault, consumer) scope, so removing whole scopes can't break a surviving reference. Orphaned compose markers are reported by `menv check`. | `--delete-files` deletes the consumer's generated files instead of releasing them |
```

Also delete the now-inaccurate clause in the consumer-remove prose under "The ownership rule": find the `--force — overrides reference blockers` style wording in the consumer-removal bullet and ensure it matches the table (no reference blockers). If the prose only lists release/`--delete-files`, leave it.

- [ ] **Step 7: Run the tests, then the suite**

Run: `bun test tests/generate/apply.disk.test.ts tests/core/ops/consumer.test.ts` → all pass. Then `bun test` → all pass (the program consumer-remove E2E from Plan 2 still passes — it asserts registry cascade, which is unchanged).

- [ ] **Step 8: Commit**

```bash
bun run lint:fix
git add src/core/ops/consumer.ts src/cli/program.ts src/generate/apply.ts tests/core/ops/consumer.test.ts tests/generate/apply.disk.test.ts docs/superpowers/specs/2026-06-12-menv-v2-design.md
git commit -m "feat(generate): consumer remove releases or deletes files; fix spec table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: generate command

**Files:**
- Create: `src/cli/generate.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/cli/generate.disk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/generate.disk.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { memoryIo } from "../../src/cli/output.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import type { Registry } from "../../src/registry/types.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

async function repo(): Promise<{ root: string; registry: Registry }> {
  const registry = makeRegistry();
  registry.variables = {
    PORT: { vaultMapping: { local: { api: { key: "k-port" } } } },
    URL: { vaultMapping: { local: { api: { key: "k-url" } } } },
  };
  const root = await tmpRepo(registry);
  roots.push(root);
  const s = await openVaultSession(root, registry, "local", FLAGS);
  await s.set("k-port", "3000");
  await s.set("k-url", "http://localhost:${PORT}");
  await s.close();
  return { root, registry };
}

describe("runGenerate", () => {
  test("writes the consumer's .env with interpolation; result lists paths not values", async () => {
    const { root, registry } = await repo();
    const io = memoryIo();
    await runGenerate(root, registry, {}, FLAGS, io);
    const env = await Bun.file(join(root, "apps/api/.env")).text();
    expect(env).toContain("URL=http://localhost:3000");
    const envelope = JSON.parse(io.out.join(""));
    expect(envelope.result.written).toContain("apps/api/.env");
    expect(io.out.join("")).not.toContain("3000"); // values never in the result envelope
  });

  test("--dry-run writes nothing", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, { ...FLAGS, dryRun: true }, memoryIo());
    expect(await Bun.file(join(root, "apps/api/.env")).exists()).toBe(false);
  });

  test("a second run reports unchanged and rewrites nothing", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const io = memoryIo();
    await runGenerate(root, registry, {}, FLAGS, io);
    expect(JSON.parse(io.out.join("")).result.unchanged).toContain("apps/api/.env");
  });

  test("an interpolation cycle is a domain error (exit 1), nothing written", async () => {
    const { root, registry } = await repo();
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-url", "${URL}");
    await s.close();
    try {
      await runGenerate(root, registry, {}, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
    expect(await Bun.file(join(root, "apps/api/.env")).exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/cli/generate.disk.test.ts`
Expected: FAIL — cannot resolve `src/cli/generate.ts`.

- [ ] **Step 3: Implement**

Create `src/cli/generate.ts`:

```ts
import { MenvError } from "../core/errors.ts";
import type { PlanIssue } from "../core/plan.ts";
import { applyPreview, previewGenerate, vaultsNeeded } from "../generate/generate.ts";
import { previewCompose } from "../generate/compose.ts";
import type { Registry } from "../registry/types.ts";
import { emitResult } from "./output.ts";
import type { Io } from "./output.ts";
import { openVaultSession } from "./run.ts";
import type { MutationFlags, PromptFn } from "./run.ts";

export interface GenerateArgs {
  vault?: string;
  consumer?: string;
}

function prettyGenerate(
  res: { written: string[]; unchanged: string[]; refused: string[]; warnings: PlanIssue[] },
  dryRun: boolean,
): string {
  const lines = [
    `${dryRun ? "would write" : "wrote"}: ${res.written.length} · unchanged: ${res.unchanged.length} · refused: ${res.refused.length}`,
    ...res.written.map((p) => `  ${dryRun ? "~" : "+"} ${p}`),
    ...res.refused.map((p) => `  ! ${p} (exists without the menv marker — left as is)`),
    ...res.warnings.map((w) => `  ⚠ ${w.code}: ${w.message}`),
  ];
  return lines.join("\n");
}

// generate is the ONLY writer of generated files. It mutates neither registry
// nor vault, so it does not go through runMutation. Compose runs only on an
// unfiltered generate (no --consumer). Output reports PATHS, never content.
export async function runGenerate(
  root: string,
  registry: Registry,
  args: GenerateArgs,
  flags: MutationFlags,
  io: Io,
  promptFn?: PromptFn,
): Promise<void> {
  const runCompose = args.consumer === undefined && registry.compose.files.length > 0;
  const vaults = new Set(vaultsNeeded(registry, args));
  if (runCompose) vaults.add(args.vault ?? registry.defaults.vault);
  const sessions = new Map();
  try {
    for (const v of [...vaults].sort()) sessions.set(v, await openVaultSession(root, registry, v, flags, promptFn));
    const envPreview = await previewGenerate(root, registry, args, sessions);
    const composePreview = runCompose
      ? await previewCompose(root, registry, { vault: args.vault }, sessions)
      : { writes: [], errors: [] as PlanIssue[], warnings: [] as PlanIssue[] };
    if (composePreview.errors.length > 0) {
      throw new MenvError("VALIDATION", `compose: ${composePreview.errors.map((e) => e.message).join("; ")}`, composePreview.errors);
    }
    const writes = [...envPreview.writes, ...composePreview.writes];
    const result = {
      written: writes.map((w) => w.path),
      unchanged: envPreview.unchanged,
      refused: envPreview.refused,
      warnings: [...envPreview.warnings, ...composePreview.warnings],
    };
    if (flags.dryRun) {
      emitResult(io, flags.mode, { dryRun: true, ...result }, prettyGenerate(result, true));
      return;
    }
    await applyPreview(root, { ...envPreview, writes });
    emitResult(io, flags.mode, { applied: true, ...result }, prettyGenerate(result, false));
  } finally {
    await Promise.allSettled([...sessions.values()].map((s) => s.close()));
  }
}
```

- [ ] **Step 4: Wire the command in program.ts**

Add the import and command. After the `compose` command group (or anywhere among the top-level commands), insert:

```ts
import { runGenerate } from "./generate.ts";
```

```ts
  program
    .command("generate")
    .description("regenerate .env files (and compose) from the vault — the only writer of outputs")
    .option("--vault <vault>", "vault to materialize (default: defaults.vault)")
    .option("--consumer <consumer>", "limit to one consumer (skips compose)")
    .action(async (o) => {
      const registry = await reg();
      await runGenerate(root, registry, { vault: o.vault, consumer: o.consumer }, flags(), io, prompt);
    });
```

- [ ] **Step 5: Run the test, then the suite**

Run: `bun test tests/cli/generate.disk.test.ts` → 4 pass. Then `bun test` → all pass.

- [ ] **Step 6: Commit**

```bash
bun run lint:fix
git add src/cli/generate.ts src/cli/program.ts tests/cli/generate.disk.test.ts
git commit -m "feat(cli): generate command — env files + compose, dry-run, path-only output

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: check command

**Files:**
- Create: `src/cli/check.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/cli/check.disk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/check.disk.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { memoryIo } from "../../src/cli/output.ts";
import { runCheck } from "../../src/cli/check.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import type { Registry } from "../../src/registry/types.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

// Called directly (not via the entry point), runCheck EMITS the ok envelope on
// success but THROWS on errors — findings ride on the MenvError's `details`.
function passedFindings(io: ReturnType<typeof memoryIo>): string[] {
  return (JSON.parse(io.out.join("")).result.findings as { code: string }[]).map((f) => f.code);
}
function failedFindings(e: unknown): string[] {
  return ((e as MenvError).details as { code: string }[]).map((f) => f.code);
}

async function repo(): Promise<{ root: string; registry: Registry }> {
  const registry = makeRegistry();
  registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k-port" } } } } };
  const root = await tmpRepo(registry);
  roots.push(root);
  const s = await openVaultSession(root, registry, "local", FLAGS);
  await s.set("k-port", "3000");
  await s.close();
  return { root, registry };
}

describe("runCheck", () => {
  test("a freshly generated repo passes (exit 0)", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const io = memoryIo();
    await runCheck(root, registry, FLAGS, io); // resolves = exit 0
    const env = JSON.parse(io.out.join(""));
    expect(env.ok).toBe(true);
    expect(passedFindings(io)).not.toContain("STALE");
  });

  test("a hand-edited generated file is STALE", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const cur = await Bun.file(join(root, "apps/api/.env")).text();
    await Bun.write(join(root, "apps/api/.env"), `${cur}EXTRA=1\n`);
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect(failedFindings(e)).toContain("STALE");
    }
  });

  test("a foreign file at an expected path is FOREIGN_FILE", async () => {
    const { root, registry } = await repo();
    await Bun.write(join(root, "apps/api/.env"), "HAND=made\n");
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("FOREIGN_FILE");
    }
  });

  test("an unresolved interpolation reference is INTERPOLATION", async () => {
    const { root, registry } = await repo();
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-port", "${GHOST}");
    await s.close();
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("INTERPOLATION");
    }
  });

  test("a compose marker naming an unknown consumer is COMPOSE_UNKNOWN_CONSUMER", async () => {
    const { root, registry } = await repo();
    registry.compose = { files: ["docker-compose.yml"] }; // runCheck reads the passed registry
    await Bun.write(join(root, "docker-compose.yml"), "x:\n  # <menv:ghost>\n  # </menv>\n");
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("COMPOSE_UNKNOWN_CONSUMER");
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/cli/check.disk.test.ts`
Expected: FAIL — cannot resolve `src/cli/check.ts`.

- [ ] **Step 3: Implement**

Create `src/cli/check.ts`:

```ts
import { MenvError } from "../core/errors.ts";
import { findMarkerRegions } from "../generate/compose.ts";
import { previewGenerate, scopeEntries } from "../generate/generate.ts";
import { headerVault, hasOwnershipMarker } from "../generate/ownership.ts";
import { consumerPaths, envTargets } from "../generate/paths.ts";
import type { Registry } from "../registry/types.ts";
import { resolveVaultAuthOptional } from "../vault/auth.ts";
import { getProvider } from "../vault/registry.ts";
import type { VaultSession } from "../vault/provider.ts";
import { emitResult } from "./output.ts";
import type { Io } from "./output.ts";
import type { MutationFlags } from "./run.ts";

interface Finding {
  severity: "error" | "warning";
  code: string;
  message: string;
}
const err = (code: string, message: string): Finding => ({ severity: "error", code, message });
const warn = (code: string, message: string): Finding => ({ severity: "warning", code, message });

async function gitTracked(root: string): Promise<Set<string> | null> {
  try {
    const proc = Bun.spawn(["git", "-C", root, "ls-files"], { stdout: "pipe", stderr: "ignore" });
    if ((await proc.exited) !== 0) return null;
    const text = await new Response(proc.stdout).text();
    return new Set(text.split("\n").filter((l) => l !== ""));
  } catch {
    return null;
  }
}

// Read-only health gate. Collects every finding, then exits 1 if any is an
// error (the entry point maps the thrown VALIDATION → exit 1, carrying the full
// findings list in details). Warnings never fail the gate.
export async function runCheck(root: string, registry: Registry, flags: MutationFlags, io: Io): Promise<void> {
  const findings: Finding[] = [];
  const sessions = new Map<string, VaultSession>();
  for (const [name, def] of Object.entries(registry.vaults)) {
    try {
      const auth = await resolveVaultAuthOptional(name, { root, flag: flags.vaultAuth[name], env: flags.env });
      sessions.set(name, await getProvider(def.vaultType).init(def.vaultConfig, { root, auth }));
    } catch (e) {
      if (e instanceof MenvError && (e.code === "AUTH_MISSING" || e.code === "AUTH_FAILED")) {
        findings.push(warn("UNVERIFIED_VAULT", `vault "${name}" could not be opened — checks against it skipped`));
      } else throw e;
    }
  }

  try {
    // Interpolation, missing values, key existence (MISSING_VALUE) per scope.
    for (const target of envTargets(registry.consumers, registry.defaults, {})) {
      const session = sessions.get(target.vault);
      if (session === undefined) continue;
      const w: { code: string; message: string }[] = [];
      try {
        await scopeEntries(registry, target.consumer, target.vault, session, w);
      } catch (e) {
        if (e instanceof MenvError) findings.push(err("INTERPOLATION", `${target.consumer}/${target.vault}: ${e.message}`));
        else throw e;
      }
      for (const mv of w) findings.push(warn(mv.code, mv.message));
    }

    // Staleness / foreign files, judged against each file's recorded vault.
    const previewCache = new Map<string, Awaited<ReturnType<typeof previewGenerate>>>();
    for (const [consumer, def] of Object.entries(registry.consumers)) {
      const paths = consumerPaths(def);
      const allPaths = [...paths.main, ...paths.local, ...(paths.example !== undefined ? [paths.example] : [])];
      for (const rel of allPaths) {
        const file = Bun.file(`${root}/${rel}`);
        if (!(await file.exists())) continue;
        const content = await file.text();
        if (!hasOwnershipMarker(content)) {
          findings.push(err("FOREIGN_FILE", `${rel} exists but is not menv-managed (no marker)`));
          continue;
        }
        const vault = headerVault(content) ?? registry.defaults.vault;
        const key = `${consumer}|${vault}`;
        let preview = previewCache.get(key);
        if (preview === undefined) {
          preview = await previewGenerate(root, registry, { consumer, vault }, sessions);
          previewCache.set(key, preview);
        }
        if (preview.writes.some((wr) => wr.path === rel)) findings.push(err("STALE", `${rel} differs from what generate would write`));
      }
    }

    // Compose markers ↔ registry.
    for (const cfile of registry.compose.files) {
      const cf = Bun.file(`${root}/${cfile}`);
      if (!(await cf.exists())) {
        findings.push(err("MISSING_COMPOSE_FILE", `registered compose file not found: ${cfile}`));
        continue;
      }
      const { regions, errors } = findMarkerRegions(await cf.text());
      for (const e of errors) findings.push(err("COMPOSE_MARKER", `${cfile}: ${e}`));
      if (regions.length === 0) findings.push(warn("COMPOSE_NO_MARKERS", `${cfile}: bound but has no menv markers`));
      for (const r of regions) {
        if (registry.consumers[r.consumer] === undefined) {
          findings.push(err("COMPOSE_UNKNOWN_CONSUMER", `${cfile}: marker names unknown consumer "${r.consumer}"`));
        }
      }
    }

    // Git-tracking violations.
    const tracked = await gitTracked(root);
    if (tracked === null) {
      findings.push(warn("GIT_UNAVAILABLE", "git not available — tracking checks skipped"));
    } else {
      for (const [name, def] of Object.entries(registry.vaults)) {
        const cfg = def.vaultConfig as { filename?: string; encryption?: boolean };
        if (def.vaultType === "menv-local" && cfg.encryption === false && typeof cfg.filename === "string" && tracked.has(cfg.filename)) {
          findings.push(err("PLAINTEXT_VAULT_TRACKED", `plaintext vault "${name}" file ${cfg.filename} is tracked by git`));
        }
      }
      for (const [consumer, def] of Object.entries(registry.consumers)) {
        const hasSecret = Object.values(registry.variables).some(
          (v) => v.secret === true && Object.values(v.vaultMapping).some((m) => m[consumer] !== undefined),
        );
        if (!hasSecret) continue;
        const paths = consumerPaths(def);
        const split = def.strategyConfig.secretsAsLocalOverrides === true;
        const risky = split ? paths.local : paths.main; // secrets live in .local when split, else in main
        for (const p of risky) {
          if (tracked.has(p)) findings.push(err("SECRET_FILE_TRACKED", `${p} may contain secret values and is tracked by git`));
        }
      }
    }
  } finally {
    await Promise.allSettled([...sessions.values()].map((s) => s.close()));
  }

  const errors = findings.filter((f) => f.severity === "error");
  const pretty =
    findings.length === 0
      ? "all checks passed"
      : findings.map((f) => `${f.severity === "error" ? "✖" : "⚠"} ${f.code}: ${f.message}`).join("\n");
  if (errors.length > 0) {
    if (flags.mode === "pretty") io.stdout(`${pretty}\n`);
    throw new MenvError("VALIDATION", `check found ${errors.length} error(s)`, findings);
  }
  emitResult(io, flags.mode, { findings }, pretty);
}
```

- [ ] **Step 4: Wire the command**

In `src/cli/program.ts`, add:

```ts
import { runCheck } from "./check.ts";
```

```ts
  program
    .command("check")
    .description("validate the repo: interpolation, vault keys, compose markers, staleness, git tracking")
    .action(async () => {
      const registry = await reg();
      await runCheck(root, registry, flags(), io);
    });
```

- [ ] **Step 5: Run the test, then the suite**

Run: `bun test tests/cli/check.disk.test.ts` → 5 pass. Then `bun test` → all pass.

- [ ] **Step 6: Commit**

```bash
bun run lint:fix
git add src/cli/check.ts src/cli/program.ts tests/cli/check.disk.test.ts
git commit -m "feat(cli): check — interpolation, staleness, compose markers, git tracking

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: backup / restore

**Files:**
- Create: `src/io/backup.ts`, `src/cli/backupCmd.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/io/backup.disk.test.ts`, `tests/cli/backupCmd.disk.test.ts`

- [ ] **Step 1: Write the failing io test**

Create `tests/io/backup.disk.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { openVaultSession } from "../../src/cli/run.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import { backupKey, collectBackupPaths, createBackup, listBackups, restoreBackup } from "../../src/io/backup.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

describe("backupKey", () => {
  test("formats a stable sortable timestamp", () => {
    expect(backupKey(new Date(Date.UTC(2026, 5, 12, 9, 8, 7)))).toMatch(/^2026061[12]-\d{6}$/);
  });
});

describe("collect / create / restore", () => {
  async function repo() {
    const registry = makeRegistry();
    registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k" } } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k", "3000");
    await s.close();
    await runGenerate(root, registry, {}, FLAGS, { stdout() {}, stderr() {} });
    return { root, registry };
  }

  test("captures registry, vault file, and marker-bearing generated files only", async () => {
    const { root, registry } = await repo();
    await Bun.write(join(root, "apps/api/STRAY.txt"), "ignore me\n");
    const paths = await collectBackupPaths(root, registry);
    expect(paths).toContain("menv.json");
    expect(paths).toContain(".menv/vault.json");
    expect(paths).toContain("apps/api/.env");
    expect(paths).not.toContain("apps/api/STRAY.txt");
  });

  test("restore brings back overwritten files", async () => {
    const { root, registry } = await repo();
    const key = backupKey(new Date());
    await createBackup(root, key, await collectBackupPaths(root, registry));
    expect(await listBackups(root)).toContain(key);
    await Bun.write(join(root, "apps/api/.env"), "WIPED=1\n");
    const restored = await restoreBackup(root, key);
    expect(restored).toContain("apps/api/.env");
    expect(await Bun.file(join(root, "apps/api/.env")).text()).not.toBe("WIPED=1\n");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/io/backup.disk.test.ts`
Expected: FAIL — cannot resolve `src/io/backup.ts`.

- [ ] **Step 3: Implement io/backup.ts**

Create `src/io/backup.ts`:

```ts
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hasOwnershipMarker } from "../generate/ownership.ts";
import { consumerPaths } from "../generate/paths.ts";
import { REGISTRY_FILENAME } from "../registry/persist.ts";
import type { Registry } from "../registry/types.ts";

const BACKUPS_DIR = ".menv/backups";

export function backupKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// A backup captures the registry, every menv-local vault file (ciphertext as
// is), and every menv-managed generated file (marker-bearing only — a file the
// user took over is theirs, not ours to snapshot).
export async function collectBackupPaths(root: string, registry: Registry): Promise<string[]> {
  const out = new Set<string>();
  if (await Bun.file(join(root, REGISTRY_FILENAME)).exists()) out.add(REGISTRY_FILENAME);
  for (const def of Object.values(registry.vaults)) {
    const cfg = def.vaultConfig as { filename?: string };
    if (def.vaultType === "menv-local" && typeof cfg.filename === "string" && (await Bun.file(join(root, cfg.filename)).exists())) {
      out.add(cfg.filename);
    }
  }
  const candidates = new Set<string>();
  for (const def of Object.values(registry.consumers)) {
    const p = consumerPaths(def);
    for (const c of [...p.main, ...p.local, ...(p.example !== undefined ? [p.example] : [])]) candidates.add(c);
  }
  for (const f of registry.compose.files) {
    candidates.add(join(dirname(f) === "." ? "" : dirname(f), ".env.compose"));
  }
  for (const rel of candidates) {
    const file = Bun.file(join(root, rel));
    if ((await file.exists()) && hasOwnershipMarker(await file.text())) out.add(rel);
  }
  return [...out].sort();
}

export async function createBackup(root: string, key: string, paths: string[]): Promise<string> {
  for (const rel of paths) {
    const dest = join(root, BACKUPS_DIR, key, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(root, rel), dest);
  }
  return join(BACKUPS_DIR, key);
}

export async function listBackups(root: string): Promise<string[]> {
  try {
    const entries = await readdir(join(root, BACKUPS_DIR), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export async function restoreBackup(root: string, key: string): Promise<string[]> {
  const base = join(root, BACKUPS_DIR, key);
  const restored: string[] = [];
  const walk = async (relDir: string): Promise<void> => {
    for (const e of await readdir(join(base, relDir), { withFileTypes: true })) {
      const rel = relDir === "" ? e.name : join(relDir, e.name);
      if (e.isDirectory()) {
        await walk(rel);
      } else {
        const dest = join(root, rel);
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(join(base, rel), dest);
        restored.push(rel);
      }
    }
  };
  await walk("");
  return restored.sort();
}
```

- [ ] **Step 4: Write the failing handler test**

Create `tests/cli/backupCmd.disk.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runBackup, runRestore } from "../../src/cli/backupCmd.ts";
import { memoryIo } from "../../src/cli/output.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});
const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

async function repo() {
  const registry = makeRegistry();
  registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k" } } } } };
  const root = await tmpRepo(registry);
  roots.push(root);
  const s = await openVaultSession(root, registry, "local", FLAGS);
  await s.set("k", "3000");
  await s.close();
  await runGenerate(root, registry, {}, FLAGS, memoryIo());
  return { root, registry };
}

const NO_TTY = { isTTY: false, pick: async () => "", confirm: async () => true };

describe("runBackup / runRestore", () => {
  test("backup then restore --force round-trips a wiped file", async () => {
    const { root, registry } = await repo();
    const io = memoryIo();
    await runBackup(root, registry, FLAGS, io);
    const key = JSON.parse(io.out.join("")).result.key as string;
    await Bun.write(join(root, "apps/api/.env"), "WIPED=1\n");
    await runRestore(root, { key, force: true }, FLAGS, memoryIo(), NO_TTY);
    expect(await Bun.file(join(root, "apps/api/.env")).text()).not.toBe("WIPED=1\n");
  });

  test("restore without a key and no TTY is a usage error", async () => {
    const { root } = await repo();
    await runBackup(root, makeRegistry(), FLAGS, memoryIo());
    try {
      await runRestore(root, { force: true }, FLAGS, memoryIo(), NO_TTY);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });

  test("restore with a key but no --force and no TTY refuses to overwrite", async () => {
    const { root, registry } = await repo();
    const io = memoryIo();
    await runBackup(root, registry, FLAGS, io);
    const key = JSON.parse(io.out.join("")).result.key as string;
    try {
      await runRestore(root, { key, force: false }, FLAGS, memoryIo(), NO_TTY);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });
});
```

- [ ] **Step 5: Implement cli/backupCmd.ts**

Create `src/cli/backupCmd.ts`:

```ts
import { MenvError } from "../core/errors.ts";
import { backupKey, collectBackupPaths, createBackup, listBackups, restoreBackup } from "../io/backup.ts";
import type { Registry } from "../registry/types.ts";
import { emitResult } from "./output.ts";
import type { Io } from "./output.ts";
import type { MutationFlags } from "./run.ts";

export async function runBackup(root: string, registry: Registry, flags: MutationFlags, io: Io, now: Date = new Date()): Promise<void> {
  const key = backupKey(now);
  const paths = await collectBackupPaths(root, registry);
  const rel = await createBackup(root, key, paths);
  emitResult(io, flags.mode, { key, files: paths }, `Backup saved in ${rel} (${paths.length} files)`);
}

export interface RestoreDeps {
  isTTY: boolean;
  pick: (keys: string[]) => Promise<string>;
  confirm: (key: string) => Promise<boolean>;
}

// Non-interactive promise: with no TTY a key is required AND --force must be
// passed to skip the overwrite confirmation. On a TTY, pick/confirm prompt.
export async function runRestore(
  root: string,
  args: { key?: string; force: boolean },
  flags: MutationFlags,
  io: Io,
  deps: RestoreDeps,
): Promise<void> {
  const keys = await listBackups(root);
  if (keys.length === 0) throw new MenvError("NOT_FOUND", "no backups found");
  let key = args.key;
  if (key === undefined) {
    if (!deps.isTTY) throw new MenvError("VALIDATION", "restore needs a backup key (no TTY to pick one)");
    key = await deps.pick(keys);
  }
  if (!keys.includes(key)) {
    throw new MenvError("NOT_FOUND", `unknown backup "${key}" (have: ${keys.join(", ")})`);
  }
  if (!args.force) {
    if (!deps.isTTY) {
      throw new MenvError("VALIDATION", "restore overwrites files — pass --force to proceed without a TTY");
    }
    if (!(await deps.confirm(key))) {
      emitResult(io, flags.mode, { restored: [] }, "aborted");
      return;
    }
  }
  const restored = await restoreBackup(root, key);
  emitResult(io, flags.mode, { key, restored }, `restored ${restored.length} files from ${key}`);
}

// Minimal stdin line reader for the TTY pick/confirm (no Ink in v2.0).
async function readLine(promptText: string): Promise<string> {
  process.stderr.write(promptText);
  for await (const chunk of process.stdin) return new TextDecoder().decode(chunk as Uint8Array).trim();
  return "";
}

export const defaultRestoreDeps: RestoreDeps = {
  isTTY: process.stdin.isTTY === true,
  pick: async (keys) => {
    process.stderr.write(`${keys.map((k, i) => `  ${i + 1}) ${k}`).join("\n")}\n`);
    const ans = await readLine("restore which? (number or key): ");
    const idx = Number.parseInt(ans, 10);
    return Number.isNaN(idx) ? ans : (keys[idx - 1] ?? ans);
  },
  confirm: async (key) => (await readLine(`overwrite files from "${key}"? [y/N]: `)).toLowerCase().startsWith("y"),
};
```

- [ ] **Step 6: Wire the commands**

In `src/cli/program.ts`:

```ts
import { defaultRestoreDeps, runBackup, runRestore } from "./backupCmd.ts";
```

```ts
  program
    .command("backup")
    .description("snapshot menv.json, the vault files, and the generated files into .menv/backups")
    .action(async () => {
      const registry = await reg();
      await runBackup(root, registry, flags(), io);
    });
  program
    .command("restore [key]")
    .description("restore a backup (omit key to pick one on a TTY; --force skips the confirmation)")
    .action(async (key) => {
      const registry = await reg();
      await runRestore(root, { key, force: flags().force }, flags(), io, defaultRestoreDeps);
    });
```

- [ ] **Step 7: Run the tests, then the suite**

Run: `bun test tests/io/backup.disk.test.ts tests/cli/backupCmd.disk.test.ts` → all pass. Then `bun test` → all pass.

- [ ] **Step 8: Commit**

```bash
bun run lint:fix
git add src/io/backup.ts src/cli/backupCmd.ts src/cli/program.ts tests/io/backup.disk.test.ts tests/cli/backupCmd.disk.test.ts
git commit -m "feat(cli): explicit backup/restore — snapshot registry, vaults, generated files

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: shell completions

**Files:**
- Create: `src/cli/completions.ts`
- Modify: `src/cli/program.ts`
- Test: `tests/cli/completions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/completions.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { memoryIo } from "../../src/cli/output.ts";
import { buildProgram } from "../../src/cli/program.ts";
import { emitBash, emitCompletions, emitZsh, walkCommands } from "../../src/cli/completions.ts";

const program = () => buildProgram("/tmp/unused", memoryIo());

describe("walkCommands", () => {
  test("enumerates nested noun-verb paths and long flags", () => {
    const { commands, flags } = walkCommands(program());
    expect(commands).toContain("vault add");
    expect(commands).toContain("var define");
    expect(commands).toContain("generate");
    expect(commands).toContain("completions");
    expect(flags).toContain("--vault-auth");
    expect(flags).toContain("--dry-run");
    expect(flags).toContain("--delete-files");
  });
});

describe("emit drift guard", () => {
  test("every command path and long flag appears in both scripts", () => {
    const p = program();
    const { commands, flags } = walkCommands(p);
    const zsh = emitZsh(p);
    const bash = emitBash(p);
    for (const c of commands) {
      expect(zsh).toContain(c);
      expect(bash).toContain(c);
    }
    for (const f of flags) {
      expect(zsh).toContain(f);
      expect(bash).toContain(f);
    }
  });

  test("emitCompletions dispatches by shell, rejects unknown", () => {
    expect(emitCompletions(program(), "zsh")).toContain("#compdef menv");
    expect(emitCompletions(program(), "bash")).toContain("complete -F");
    expect(() => emitCompletions(program(), "fish")).toThrow("unsupported shell");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/cli/completions.test.ts`
Expected: FAIL — cannot resolve `src/cli/completions.ts`.

- [ ] **Step 3: Implement**

Create `src/cli/completions.ts`:

```ts
import type { Command } from "@commander-js/extra-typings";
import { MenvError } from "../core/errors.ts";

// Walk the live commander tree, so completions cannot drift from the grammar:
// new commands/flags appear automatically. The drift-guard test still asserts
// coverage to catch an emit bug.
export function walkCommands(program: Command): { commands: string[]; flags: string[] } {
  const commands: string[] = [];
  const flags = new Set<string>();
  for (const o of program.options) if (o.long !== undefined) flags.add(o.long);
  const recurse = (cmd: Command, prefix: string[]): void => {
    for (const sub of cmd.commands as Command[]) {
      const path = [...prefix, sub.name()];
      commands.push(path.join(" "));
      for (const o of sub.options) if (o.long !== undefined) flags.add(o.long);
      recurse(sub, path);
    }
  };
  recurse(program, []);
  return { commands: commands.sort(), flags: [...flags].sort() };
}

export function emitZsh(program: Command): string {
  const { commands, flags } = walkCommands(program);
  const cmdArr = commands.map((c) => `'${c}'`).join(" ");
  const flagArr = flags.map((f) => `'${f}'`).join(" ");
  return [
    "#compdef menv",
    "# menv zsh completion — generated by `menv completions zsh`.",
    "# Install: menv completions zsh > \"${fpath[1]}/_menv\"  (or: source <(menv completions zsh))",
    "_menv() {",
    `  local -a _menv_cmds=(${cmdArr})`,
    `  local -a _menv_flags=(${flagArr})`,
    "  _arguments '1: :->cmd' '*: :->rest'",
    "  case $state in",
    "    cmd)  compadd -- ${_menv_cmds%% *} ;;",
    "    rest) compadd -- $_menv_flags ${_menv_cmds} ;;",
    "  esac",
    "}",
    "compdef _menv menv",
    "",
  ].join("\n");
}

export function emitBash(program: Command): string {
  const { commands, flags } = walkCommands(program);
  const words = [...new Set([...commands.flatMap((c) => c.split(" ")), ...flags])].sort().join(" ");
  return [
    "# menv bash completion — generated by `menv completions bash`.",
    "# Install: source <(menv completions bash)",
    "# Commands: " + commands.join(", "),
    "_menv() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    `  COMPREPLY=( $(compgen -W "${words}" -- "$cur") )`,
    "}",
    "complete -F _menv menv",
    "",
  ].join("\n");
}

export function emitCompletions(program: Command, shell: string): string {
  if (shell === "zsh") return emitZsh(program);
  if (shell === "bash") return emitBash(program);
  throw new MenvError("VALIDATION", `unsupported shell "${shell}" (zsh | bash)`);
}
```

- [ ] **Step 4: Wire the command**

In `src/cli/program.ts`:

```ts
import { emitCompletions } from "./completions.ts";
```

```ts
  program
    .command("completions <shell>")
    .description("print a shell completion script (zsh | bash)")
    .action((shell) => {
      io.stdout(emitCompletions(program, shell));
    });
```

(The action closes over `program` — by the time it runs, the whole tree is built.)

- [ ] **Step 5: Run the test, then the suite**

Run: `bun test tests/cli/completions.test.ts` → 4 pass. Then `bun test` → all pass.

- [ ] **Step 6: Commit**

```bash
bun run lint:fix
git add src/cli/completions.ts src/cli/program.ts tests/cli/completions.test.ts
git commit -m "feat(cli): zsh/bash completions generated from the commander tree

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Docs rewrite + drop the unused yaml dep

**Files:**
- Modify: `package.json`
- Rewrite: `CLAUDE.md`, `README.md`, `skills/menv-usage/SKILL.md`

This is the task that lifts the v2-stale banners. Do it ONLY now, with the whole CLI working, so every documented command can be verified against `bun run menv <cmd> --help`.

- [ ] **Step 1: Drop the unused yaml dependency**

`yaml` is no longer used anywhere (compose splicing is line-based — confirm with `grep -rn "from \"yaml\"" src tests`, expect no hits). Remove the `"yaml": "^2.9.0"` line from `package.json` dependencies, then:

Run: `bun install`
Expected: lockfile updates, exit 0. Then `bun test` → still all green.

- [ ] **Step 2: Rewrite CLAUDE.md**

Replace the ENTIRE file (banner included — it goes away) with:

```markdown
# menv — agent guide

A CLI for managing environment variables across a monorepo. Runtime is **Bun**
(not Node) — `.ts` runs directly, no build step for development. The **registry**
(`menv.json`) is the single source of truth for *structure*; **values live in
pluggable vaults**; plaintext `.env` files are *generated* from the vault on
demand and git-ignored.

Mental model: edit structure (registry) and values (vaults) via the CLI; never
hand-edit a generated `.env` — it is an output, rewritten by `menv generate`.

## Commands

```bash
bun install            # install deps
bun run menv           # run the CLI from source (src/index.ts)
bun run menv init      # create an empty registry + local vault config
bun run menv generate  # vault → .env (+ compose) regenerate
bun run menv check     # validate the repo (CI gate; exit 1 on findings)
bun test               # whole suite
bun test tests/cli/program.disk.test.ts   # a single file
bun run lint           # Biome: lint + import-sort (read-only)
bun run lint:fix       # Biome: apply safe fixes
bun run build          # compile a standalone ./menv binary
```

Full CLI grammar and concepts live in `README.md`. The command set (`init`;
`vault`/`consumer`/`group`/`global`/`compose` management; `var
define/update/remove/list/show`; `wire`/`unwire`/`enable`/`disable`; `set`/`get`;
`import`; `generate`; `check`; `backup`/`restore`; `completions`) is built in
`src/cli/program.ts`.

## Structure

- `src/cli/` — commander v15 program (`program.ts`), entry (`index.ts`), command handlers, output/prompt/run plumbing
- `src/core/` — pure domain: `errors.ts`, `interpolate.ts`, `refs.ts`, `plan.ts`, and the op planners in `src/core/ops/` (no I/O)
- `src/registry/` — `menv.json` types, validation, load/save
- `src/vault/` — `VaultProvider` contract, provider registry, `providers/local.ts` (age encryption), auth resolution
- `src/generate/` — ownership/disclaimer, renderers, consumer paths, compose splicing, the generate orchestrator, file-op applier
- `src/io/` — atomic write, dotenv parse, root discovery, `.gitignore` block, backups
- `tests/` — mirrors `src/` one-to-one (`bun:test`)

On-disk layout `init` creates and the CLI manages:

```text
menv.json              # registry — committed
.menv/vault.json       # menv-local store — committed IF encrypted, git-ignored if plaintext
.menv/auth.local.json  # per-machine vault auth — git-ignored, never committed
.menv/backups/         # `menv backup` snapshots — git-ignored
apps/*/.env            # GENERATED — git-ignored, never hand-edited
apps/*/.env.example    # GENERATED values-free template — committed (per-consumer opt-in)
.env.compose           # GENERATED compose interpolation values — git-ignored
```

## Security model

Values live in vaults, addressed by the keys in each variable's `vaultMapping`;
the registry never contains a value. `menv-local` optionally age-encrypts its
JSON (`encryption: true` ⇒ committable ciphertext; `false` ⇒ plaintext, must
stay git-ignored — `menv check` enforces both). The key resolves per vault:
`--vault-auth <vault>=…`, `MENV_VAULT_AUTH_<NAME>`, a `.menv/auth.local.json`
hook (`command`/`env`/`value`), then a TTY prompt. Anything in `src/vault/` is
security-sensitive.

## Code style

- **Bun-first** — `Bun.file`, `Bun.write`, `Bun.argv`, not the Node equivalents. Top-level `await` is fine.
- **ESM with explicit extensions** — ✅ `from "./cli/program.ts"`  🚫 `from "./cli/program"` (required by `allowImportingTsExtensions`).
- **Named exports only** — 🚫 `export default`. `type`-only imports for types.
- **strict TypeScript** — no `any` escape hatches; model nullability honestly. `biome.json` is the style source of truth.
- Keep `src/io`/`src/vault` effects out of `src/core` (pure ops + interpolation + plan).

## Testing

`bun:test` only (`import … from "bun:test"` resolves only under Bun). `tests/`
mirrors `src/`; `.disk.test.ts` suffix for filesystem suites;
`tests/helpers/fixtures.ts` builds registries/repos.

- Op planners are pure — assert `{ next, plan }` without I/O; secrets must never appear in `planToJson` output.
- Every `VaultProvider` runs the shared conformance suite (`tests/vault/conformance.ts`).
- New behavior needs a test; a fixed bug gets a regression test.

## Mutation ≠ generation

Registry/vault mutations (`set`, `wire`, `var define`, …) NEVER touch generated
files. `menv generate` is the only writer of outputs; `menv check` reports
staleness. Every mutating command supports `--dry-run` and `--output pretty|json`
with a uniform `{ ok, result }` / `{ ok, error }` envelope. Exit codes: 0 success
(incl. dry-run), 1 domain error / blockers / check findings, 2 usage, 3 auth, 4 vault I/O.

## The ownership rule

menv only overwrites or deletes a file whose FIRST line carries the disclaimer
marker (`src/generate/ownership.ts`). A generated path the user has taken over
(marker removed) is left untouched and reported by `check`. `consumer remove`
strips the marker (releasing the file) by default; `--delete-files` deletes it.
Registered compose files are the exception — user-owned, menv only rewrites the
lines between hand-authored `# <menv:consumer>` … `# </menv>` markers.

## Boundaries

- ✅ **Always:** run `bun test` (whole suite) before claiming done. Keep explicit `.ts` extensions and named exports. When a command/flag, on-disk layout, vault provider, or the registry schema changes, update `README.md` in the **same** change (the completion script regenerates from the command tree — keep the drift-guard test passing).
- ⚠️ **Ask first:** changing `menv.json`'s `schemaVersion` or shape (existing repos need migration). Bumping core deps (`bun`, `commander`, `age-encryption`). Anything in `src/vault/` that changes encryption or the provider contract.
- 🚫 **Never:** commit a plaintext `.env`/`.env.*` or a plaintext vault file; print a real secret in code, tests, logs, or a plan (secrets are stripped from `planToJson` for a reason). Hand-edit a generated file — it's an output. Add a default export or reach for a Node API where a Bun one exists.

---
Source of truth: `src/` (behavior), `package.json` (commands/deps), `biome.json`
(style), `README.md` (user-facing), `docs/superpowers/specs/2026-06-12-menv-v2-design.md`
(design). Update when a command/flag, on-disk layout, vault provider, or the
registry schema changes; a core dependency is bumped; or a directory moves.
```

- [ ] **Step 3: Rewrite README.md**

Rewrite the README as the v2 user front door. It MUST cover, and every command shown MUST be verified against `bun run menv <command> --help` before you write it down:

1. **Intro & why** — registry is the source of truth for structure; values in pluggable vaults; `.env` files are generated outputs. No TUI in v2.0 (note it returns in a later release) — so **remove the screenshot/TUI sections and the `assets/screenshot.png` reference** entirely.
2. **Quick start** — `bun install`, `bun link` (optional), `menv init [--encrypt|--no-encrypt]`, then add a consumer + vault + variable, wire, set, generate.
3. **Concepts** — Registry (`menv.json`, schemaVersion 2); Vault (a named pluggable KV store that IS a generation context; `menv-local` ships, optional age encryption; HashiCorp/AWS SSM are roadmap); Consumer (explicit `baseDir` + file strategy `single`/`per-vault`, `secretsAsLocalOverrides`, `example`); Variable (globally unique name + `vaultMapping[vault][consumer] → {key, disabled?}`; same key = shared value; `disabled` = commented-out line); Group (label only); Global (per vault `runtime` pass-through or `static` substitution); Interpolation (`${NAME}` with `$${` escape — variables and static globals expand at generate, runtime globals pass through; cycles/unresolved refs abort).
4. **CLI reference** — the full command tree grouped: setup (`init`, `generate`, `check`, `completions`), management (`vault`/`consumer`/`group`/`global`/`compose` `add|update|remove|list|show`/`bind|unbind`), variables/values (`var …`, `wire`/`unwire`/`enable`/`disable`, `set`/`get`, `import`), backups (`backup`/`restore`). Document the global flags `--output pretty|json`, `--dry-run`, `--force`, `--vault-auth <vault>=<secret>` (repeatable) and `MENV_OUTPUT`.
5. **Values & secrets** — pipe on stdin or omit the arg for a masked prompt; `get` prints raw (pipeable); secrets masked in `list`/`show`, never in `--output json` plans.
6. **Generation & the ownership rule** — `menv generate` is the only writer; disclaimer header; user-owned files left alone; `consumer remove` release vs `--delete-files`; `.env.example` opt-in.
7. **Compose** — register files with `compose bind`; hand-author `# <menv:consumer>` … `# </menv>` markers; menv fills the region and writes `.env.compose`; run `docker compose --env-file .env.compose …`.
8. **Vaults, auth & encryption** — the resolution order; the three `auth.local.json` hook types with an `op read …` example; the modular `VaultProvider` contract (one-paragraph: adding a provider is a registry entry; remote providers are roadmap).
9. **Headless / CI** — `MENV_VAULT_AUTH_*` + `menv check --output json || exit 1` + `menv generate --vault production`; the non-interactive promise (no prompts off-TTY; exit codes 0/1/2/3/4).
10. **On-disk layout** + the `.gitignore` managed block + **Development** (the `bun` scripts) + a short **Security model**.

Keep the multi-line-values caveat note (still single-line in v2.0).

- [ ] **Step 4: Rewrite skills/menv-usage/SKILL.md**

Rewrite the agent skill for v2 — teach an AI agent working in a menv repo:

- The registry (`menv.json`) is the source of truth for structure; **values live in vaults**, never in the registry.
- **Never hand-edit a generated `.env`** — it's an output; change the vault (`menv set`) or registry and run `menv generate`. `menv check` flags drift.
- Pipe secret values on stdin (`printf '%s' "$V" | menv set NAME`) to keep them out of shell history.
- Prefer `--output json` for machine-readable results and `--dry-run` to preview any mutation before applying.
- Run `menv check --output json` after a batch of changes; exit 1 means problems (broken refs, stale files, git-tracking violations).
- Supply vault auth non-interactively via `MENV_VAULT_AUTH_<VAULT>` or `.menv/auth.local.json`; off a TTY, menv never prompts — a missing key is a hard error (exit 3).

Keep it short (a page). Match the existing file's frontmatter format if present.

- [ ] **Step 5: Verify and commit**

Run: `grep -rn "from \"yaml\"" src tests` → no hits. `bun test` → all green. `bun run lint` → exit 0.
Manually confirm the README's command list matches `bun run menv --help` and a few `bun run menv <cmd> --help` outputs.

```bash
bun run lint:fix
git add package.json CLAUDE.md README.md skills/menv-usage/SKILL.md
git commit -m "docs: rewrite README/CLAUDE.md/skill for v2; drop unused yaml dep

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Full verification + build inspection

**Files:** none new.

- [ ] **Step 1: Whole suite + lint**

Run: `bun test`
Expected: every test passes (≈ 230 tests), 0 fail.
Run: `bun run lint`
Expected: exit 0 (only the `noTemplateCurlyInString` warnings on `${...}` fixtures).

- [ ] **Step 2: Hand-drive the full lifecycle in a scratch dir (NOT the repo)**

```bash
cd "$(mktemp -d)"
menv() { bun /path/to/menv/src/index.ts "$@"; }   # substitute the real checkout path
menv init --no-encrypt
menv consumer add api --strategy single --base-dir apps/api --filename .env
menv group add db --title Database
menv var define DATABASE_URL --secret --group db
menv var define PUBLIC_URL
menv wire DATABASE_URL --vault local --consumers api
menv wire PUBLIC_URL  --vault local --consumers api
menv global define FQDN --vault local --value localhost:3000
printf '%s' 'postgres://localhost/app' | menv set DATABASE_URL
menv set PUBLIC_URL 'https://${FQDN}/api'
menv generate
cat apps/api/.env          # marker header; PUBLIC_URL=https://localhost:3000/api; DATABASE_URL present
menv check; echo "check=$?"            # 0
echo "EXTRA=1" >> apps/api/.env
menv check; echo "check=$?"            # 1 (STALE)
menv generate                          # back to clean
menv backup
menv get DATABASE_URL                  # raw value
menv var remove DATABASE_URL --dry-run --output json   # plan, no value
menv completions zsh | head -1         # #compdef menv
```

Expected: every non-dry command exits 0, the stale check exits 1, generated `.env` carries the marker and the expanded interpolation, and no secret value appears in the dry-run JSON.

- [ ] **Step 3: Build inspection (the compiled binary can't run here — known limitation)**

Run: `bun run build`
Expected: a `./menv` binary is produced. Do NOT execute it (it SIGKILLs in this environment). Verify it embedded the entry instead:

Run: `strings ./menv | grep -c "menv.json"` → a nonzero count (the registry filename string is embedded).
Then remove it: `rm ./menv`.

- [ ] **Step 4: Commit any stragglers**

```bash
git status --porcelain   # if empty, nothing to do
git add -A
git commit -m "chore: v2 generation & verification green — generate, check, backup, completions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## v2 is complete

With Plans 1–3 merged, the v2 spec is fully implemented: JSON registry, modular
vaults (menv-local + the public provider contract), explicit consumer/
environment/variable lifecycle, unique names with grouped values, globals +
interpolation with dependency detection, dry-run on every mutation, pretty/json
output, explicit compose binding, the generation pipeline with the ownership
rule and disclaimers, `menv check`, explicit backups, and shell completions —
all CLI-first and non-interactive-safe for humans, agents, and CI.

**Roadmap (recorded in the spec, not built):** remote vault providers (HashiCorp
Vault, AWS SSM) proving the provider contract; npm-loaded vault plugins; `menv
run -- <cmd>`; `menv apply` (atomic JSON batches); `menv diff`; the TUI rebuilt
on the v2 core; multi-line values.








