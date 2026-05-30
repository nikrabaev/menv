# Scope Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the TUI scope sidebar into a sectioned tree — a true `All` (every variable) scope, a renamed `Root` scope (the shared global-tier pool, formerly mislabeled "Global"), and dimmed `APPS` / `SERVICES` / `GROUPS` section headers for visual separation.

**Architecture:** Extract all pure scope logic out of the React components into a single testable module `src/ui/scopes.ts` (`Scope` type, `buildScopes`, `varsForScope`, `stepScope`). `ScopeTree.tsx` becomes presentation-only and renders non-selectable header rows. `app.tsx` consumes the module, uses `stepScope` to skip headers during navigation, and resets the variable cursor when the scope changes. Section headers are real one-line rows so the existing viewport/height windowing budget stays correct.

**Tech Stack:** Bun, TypeScript, Ink (React), `bun test` + `ink-testing-library`.

**Reference:** Approved design in this conversation; supersedes the `★ Global / Apps / Services / Groups` line in `docs/superpowers/specs/2026-05-30-menv-design.md`.

**Conventions:** exact file paths; full code in every code step; run the test and confirm the stated expectation before moving on; commit at the end of each task. Run from repo root `/Users/nikrabaev/Work/personal/menv`.

---

## Task 1: Pure scope module + unit tests

**Files:**
- Create: `src/ui/scopes.ts`
- Test: `tests/ui/scopes.test.ts`

This task adds the new logic in isolation. `src/ui/components/ScopeTree.tsx` still defines its own old `buildScopes`/`Scope`, and `app.tsx` still uses them — those are rewired in Task 2. The full suite stays green because the app is untouched and the new unit tests target only the new module.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/scopes.test.ts`:

```ts
import { expect, test, describe } from "bun:test";
import { buildScopes, varsForScope, stepScope } from "../../src/ui/scopes.ts";
import type { RepoModel } from "../../src/core/types.ts";

function model(): RepoModel {
  return {
    root: "/r",
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "v1", name: "DATABASE_URL", tier: "global", description: "", group: "DB", secret: true, consumers: ["app:api"] },
      { id: "v2", name: "PORT", tier: "local", ownerApp: "app:api", description: "", group: null, secret: false, consumers: ["app:api"] },
      { id: "v3", name: "WEB_FLAG", tier: "local", ownerApp: "app:web", description: "", group: null, secret: false, consumers: ["app:web"] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} },
      { kind: "app", id: "app:web", name: "web", path: "apps/web", envFiles: {} },
      { kind: "service", id: "svc:pg", name: "postgres", composeFile: "docker-compose.yml", inject: "env_file" },
    ],
    values: {},
    recipients: [],
  };
}

describe("buildScopes", () => {
  test("starts with All then Root", () => {
    const s = buildScopes(model());
    expect(s[0]).toEqual({ id: "all", label: "All", kind: "all" });
    expect(s[1]).toEqual({ id: "root", label: "Root", kind: "root" });
  });

  test("emits section headers followed by their members", () => {
    const labels = buildScopes(model()).map((x) => x.label);
    expect(labels).toEqual(["All", "Root", "APPS", "api", "web", "SERVICES", "postgres", "GROUPS", "DB"]);
    expect(buildScopes(model()).find((x) => x.label === "APPS")!.kind).toBe("header");
  });

  test("omits a section header when it has no members", () => {
    const m = model();
    m.consumers = m.consumers.filter((c) => c.kind === "app"); // drop the service
    const labels = buildScopes(m).map((x) => x.label);
    expect(labels).toContain("APPS");
    expect(labels).not.toContain("SERVICES");
  });
});

describe("varsForScope", () => {
  test("all returns every variable", () => {
    expect(varsForScope(model(), "all").map((v) => v.name).sort()).toEqual(["DATABASE_URL", "PORT", "WEB_FLAG"]);
  });
  test("root returns only global-tier variables", () => {
    expect(varsForScope(model(), "root").map((v) => v.name)).toEqual(["DATABASE_URL"]);
  });
  test("group returns members of that group", () => {
    expect(varsForScope(model(), "group:DB").map((v) => v.name)).toEqual(["DATABASE_URL"]);
  });
  test("a consumer id returns variables wired to it", () => {
    expect(varsForScope(model(), "app:api").map((v) => v.name).sort()).toEqual(["DATABASE_URL", "PORT"]);
  });
});

describe("stepScope", () => {
  test("skips a header row when moving down", () => {
    const s = buildScopes(model()); // idx1=Root, idx2=APPS(header), idx3=api
    expect(stepScope(s, 1, 1)).toBe(3);
  });
  test("skips a header row when moving up", () => {
    const s = buildScopes(model()); // idx3=api, idx2=APPS(header), idx1=Root
    expect(stepScope(s, 3, -1)).toBe(1);
  });
  test("clamps at the end", () => {
    const s = buildScopes(model());
    const last = s.length - 1;
    expect(stepScope(s, last, 1)).toBe(last);
  });
  test("clamps at the start", () => {
    expect(stepScope(buildScopes(model()), 0, -1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ui/scopes.test.ts`
Expected: FAIL — `Cannot find module '../../src/ui/scopes.ts'`.

- [ ] **Step 3: Implement `src/ui/scopes.ts`**

```ts
import type { RepoModel, Variable } from "../core/types.ts";

export type ScopeKind = "all" | "root" | "app" | "service" | "group" | "header";

export interface Scope {
  id: string;
  label: string;
  kind: ScopeKind;
}

export function isSelectable(scope: Scope): boolean {
  return scope.kind !== "header";
}

export function buildScopes(model: RepoModel): Scope[] {
  const scopes: Scope[] = [
    { id: "all", label: "All", kind: "all" },
    { id: "root", label: "Root", kind: "root" },
  ];

  const apps = model.consumers.filter((c) => c.kind === "app");
  if (apps.length) {
    scopes.push({ id: "header:apps", label: "APPS", kind: "header" });
    for (const c of apps) scopes.push({ id: c.id, label: c.name, kind: "app" });
  }

  const services = model.consumers.filter((c) => c.kind === "service");
  if (services.length) {
    scopes.push({ id: "header:services", label: "SERVICES", kind: "header" });
    for (const c of services) scopes.push({ id: c.id, label: c.name, kind: "service" });
  }

  const groups = [...new Set(model.variables.map((v) => v.group).filter(Boolean))] as string[];
  if (groups.length) {
    scopes.push({ id: "header:groups", label: "GROUPS", kind: "header" });
    for (const g of groups) scopes.push({ id: `group:${g}`, label: g, kind: "group" });
  }

  return scopes;
}

export function varsForScope(model: RepoModel, scopeId: string): Variable[] {
  if (scopeId === "all") return model.variables;
  if (scopeId === "root") return model.variables.filter((v) => v.tier === "global");
  if (scopeId.startsWith("group:")) {
    const g = scopeId.slice("group:".length);
    return model.variables.filter((v) => v.group === g);
  }
  return model.variables.filter((v) => v.consumers.includes(scopeId));
}

// Returns the next selectable index in direction `dir`, skipping header rows.
// Clamps: if there is no selectable row that way, returns `from` unchanged.
export function stepScope(scopes: Scope[], from: number, dir: 1 | -1): number {
  let i = from + dir;
  while (i >= 0 && i < scopes.length && scopes[i].kind === "header") i += dir;
  if (i < 0 || i >= scopes.length) return from;
  return i;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ui/scopes.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/scopes.ts tests/ui/scopes.test.ts
git commit -m "feat(ui): scope module with All/Root and section headers"
```

---

## Task 2: Render sections + wire the app to the scope module

**Files:**
- Modify: `src/ui/components/ScopeTree.tsx`
- Modify: `src/ui/app.tsx`
- Test: `tests/ui/app.test.tsx`

ScopeTree's old `Scope`/`buildScopes` are removed and `app.tsx`'s import path changes in the same commit, so the suite is only green again after both files are updated (Step 4).

- [ ] **Step 1: Extend the app test to assert the new sidebar, and run it to fail**

In `tests/ui/app.test.tsx`, add three assertions to the existing `"renders three panes with data"` test, right after `expect(lastFrame()).toContain("acme");`:

```tsx
  expect(lastFrame()).toContain("All");
  expect(lastFrame()).toContain("Root");
  expect(lastFrame()).toContain("APPS");
```

Run: `bun test tests/ui/app.test.tsx`
Expected: FAIL — the current sidebar renders `* Global` with no `All` / `Root` / `APPS` rows.

- [ ] **Step 2: Rewrite `src/ui/components/ScopeTree.tsx`**

Replace the entire file with:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { Scope } from "../scopes.ts";
import { listWindow } from "./listWindow.ts";

export function ScopeTree({ scopes, cursor, active = true, height }: { scopes: Scope[]; cursor: number; active?: boolean; height?: number }) {
  const maxItems = height ? Math.max(0, height - 5) : scopes.length;
  const windowed = listWindow(scopes, cursor, maxItems);
  return (
    <Box flexDirection="column" width={40} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">SCOPES</Text>
      {windowed.offset > 0 && <Text color="gray">  ...</Text>}
      {windowed.items.map((s, i) => {
        const idx = windowed.offset + i;
        if (s.kind === "header") {
          return (
            <Text key={`${s.id}:${idx}`} color="gray" bold>
              {s.label}
            </Text>
          );
        }
        return (
          <Text key={`${s.id}:${idx}`} inverse={active && idx === cursor}>
            {"  " + s.label}
          </Text>
        );
      })}
      {windowed.offset + windowed.items.length < scopes.length && <Text color="gray">  ...</Text>}
    </Box>
  );
}
```

(`buildScopes` and the `Scope` interface are deleted here — they now live in `src/ui/scopes.ts`.)

- [ ] **Step 3: Update `src/ui/app.tsx`**

Replace the entire file with:

```tsx
import React, { useState } from "react";
import { Box, Text, useApp, useInput, useStdout, render } from "ink";
import type { RepoModel } from "../core/types.ts";
import type { Store } from "../store/store.ts";
import { useModel, useDirty } from "./useStore.ts";
import { TopBar } from "./components/TopBar.tsx";
import { ScopeTree } from "./components/ScopeTree.tsx";
import { buildScopes, varsForScope, stepScope } from "./scopes.ts";
import { VariableList } from "./components/VariableList.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { EditValueModal } from "./components/EditValueModal.tsx";
import { NewVariableModal } from "./components/NewVariableModal.tsx";
import { WireModal } from "./components/WireModal.tsx";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { loadRepo } from "../store/load.ts";
import { loadOrCreateIdentity } from "../crypto/identity.ts";

type Pane = "scopes" | "vars";
type Mode = "browse" | "edit" | "new" | "wire" | "filter";

export const ENTER_FULLSCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
export const EXIT_FULLSCREEN = "\x1b[?1049l";

function isInteractiveStdout(stdout: NodeJS.WriteStream): boolean {
  return stdout.isTTY === true;
}

export function enterFullscreen(stdout: NodeJS.WriteStream = process.stdout): void {
  if (isInteractiveStdout(stdout)) stdout.write(ENTER_FULLSCREEN);
}

export function exitFullscreen(stdout: NodeJS.WriteStream = process.stdout): void {
  if (isInteractiveStdout(stdout)) stdout.write(EXIT_FULLSCREEN);
}

export function MenvApp({ store, onSaveStamp, viewportRows, viewportColumns }: {
  store: Store;
  onSaveStamp: () => string;
  viewportRows?: number;
  viewportColumns?: number;
}) {
  const model = useModel(store);
  const dirty = useDirty(store);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = viewportRows ?? stdout.rows ?? 24;
  const columns = viewportColumns ?? stdout.columns ?? 100;

  const scopes = buildScopes(model);
  const [pane, setPane] = useState<Pane>("vars");
  const [scopeCursor, setScopeCursor] = useState(0);
  const [varCursor, setVarCursor] = useState(0);
  const [env, setEnv] = useState(model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev");
  const [mode, setMode] = useState<Mode>("browse");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");
  const bottomHeight = mode === "browse" ? 1 : 3;
  const paneHeight = Math.max(3, rows - 3 - bottomHeight);

  const scope = scopes[scopeCursor];
  const variables = scope ? varsForScope(model, scope.id) : model.variables;
  const filtered = filter
    ? variables.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase()))
    : variables;
  const current = filtered[varCursor] ?? null;

  useInput((input, key) => {
    if (mode === "filter") {
      if (key.escape || key.return) {
        setMode("browse");
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((cur) => cur.slice(0, -1));
        setVarCursor(0);
        return;
      }
      if (input) {
        setFilter((cur) => cur + input);
        setVarCursor(0);
      }
      return;
    }
    if (mode !== "browse") return;
    if (input === "q") {
      exit();
      return;
    }
    if (key.tab) {
      setPane((p) => (p === "scopes" ? "vars" : "scopes"));
      return;
    }
    if (key.upArrow) {
      if (pane === "scopes") {
        const next = stepScope(scopes, scopeCursor, -1);
        setScopeCursor(next);
        if (next !== scopeCursor) setVarCursor(0);
      } else {
        setVarCursor((c) => Math.max(0, c - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (pane === "scopes") {
        const next = stepScope(scopes, scopeCursor, 1);
        setScopeCursor(next);
        if (next !== scopeCursor) setVarCursor(0);
      } else {
        setVarCursor((c) => Math.min(filtered.length - 1, c + 1));
      }
      return;
    }
    if (input === "e") {
      const ids = model.environments.map((e) => e.id);
      setEnv((cur) => ids[(ids.indexOf(cur) + 1) % ids.length]);
      return;
    }
    if (input === "d" && current) {
      store.toggleSecret(current.id);
      return;
    }
    if (key.return && current && pane === "vars") {
      setMode("edit");
      return;
    }
    if (input === "/") {
      setMode("filter");
      return;
    }
    if (input === "n") {
      setMode("new");
      return;
    }
    if (input === "w" && current) {
      setMode("wire");
      return;
    }
    if (input === "x" && current) {
      store.deleteVariable(current.id);
      setVarCursor((c) => Math.max(0, Math.min(c, filtered.length - 2)));
      return;
    }
    if (input === "s") {
      void saveModel(store.getModel(), onSaveStamp()).then((sum) => {
        store.markClean();
        setStatus(`saved ${sum.files.length} files`);
      });
    }
  });

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <TopBar root={model.root} env={env} dirty={dirty} unsaved={dirty ? 1 : 0} />
      <Box height={paneHeight}>
        <ScopeTree scopes={scopes} cursor={scopeCursor} active={pane === "scopes"} height={paneHeight} />
        <VariableList variables={filtered} cursor={varCursor} active={pane === "vars"} height={paneHeight} />
        <Inspector model={model} variable={current} env={env} height={paneHeight} />
      </Box>
      {mode === "edit" && current ? (
        <EditValueModal
          varName={current.name}
          env={env}
          initial={model.values[current.id]?.[env] ?? ""}
          onSubmit={(v) => { store.setValue(current.id, env, v); setMode("browse"); }}
          onCancel={() => setMode("browse")}
        />
      ) : mode === "filter" ? (
        <Box borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text>/ {filter}</Text>
        </Box>
      ) : mode === "new" ? (
        <NewVariableModal
          onSubmit={(name) => {
            const tier = scope?.kind === "app" ? "local" : "global";
            const ownerApp = tier === "local" ? scope!.id : undefined;
            store.addVariable({ id: `var:${name}`, name, tier, ownerApp, description: "", group: null, secret: false, consumers: ownerApp ? [ownerApp] : [] });
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      ) : mode === "wire" && current ? (
        <WireModal
          consumers={model.consumers}
          wired={current.consumers}
          onToggle={(id) => store.wire(current.id, id, !current.consumers.includes(id))}
          onClose={() => setMode("browse")}
        />
      ) : (
        <Box paddingX={1}>
          <Text color="gray">up/down move / tab pane / enter edit / / filter / n new / w wire / x delete / e env / d secret / s save / q quit  </Text>
          <Text color="green">{status}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function launchTui(root: string): Promise<void> {
  const kp = await loadOrCreateIdentity();
  const model = await loadRepo(root, kp.identity);
  const store = createStore(model);
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  let instance: ReturnType<typeof render> | undefined;
  enterFullscreen();
  try {
    instance = render(<MenvApp store={store} onSaveStamp={stamp} />);
    await instance.waitUntilExit();
  } finally {
    instance?.unmount();
    instance?.cleanup();
    exitFullscreen();
  }
}
```

Changes vs. the prior file: imports `buildScopes`/`varsForScope`/`stepScope` from `./scopes.ts` (no longer `buildScopes` from `ScopeTree.tsx`); the local `varsForScope` function is deleted; scope ↑/↓ use `stepScope` and reset `varCursor` to 0 when the scope actually changes. Everything else is unchanged.

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `bun test`
Expected: PASS — all tests green (the extended app test now finds `All` / `Root` / `APPS`).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ScopeTree.tsx src/ui/app.tsx tests/ui/app.test.tsx
git commit -m "feat(ui): sectioned scope sidebar (All, Root, APPS/SERVICES/GROUPS)"
```

---

## Task 3: Update the design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-30-menv-design.md`

- [ ] **Step 1: Update the stale scopes-tree description**

In the "TUI (Ink, three-pane)" section, replace:

```
**Regions:** Top bar (repo · env switcher · dirty indicator) · Left scopes tree
(`★ Global`, `Apps`, `Services`, `Groups`) · Middle variable list (badges: `🔒`
```

with:

```
**Regions:** Top bar (repo · env switcher · dirty indicator) · Left scopes tree
(`All`, `Root`, then dimmed `APPS` / `SERVICES` / `GROUPS` section headers with
their members) · Middle variable list (badges: `🔒`
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-30-menv-design.md
git commit -m "docs: scopes tree now All/Root + sections"
```

---

## Task 4: Final verification

- [ ] **Step 1: Run the complete test suite**

Run: `bun test`
Expected: all tests PASS (54 tests: the prior 53 plus the new scopes module, app assertions count within their file).

- [ ] **Step 2: Manual TUI smoke test**

```bash
mkdir -p /tmp/menv-scope-demo/apps/api /tmp/menv-scope-demo/apps/web && cd /tmp/menv-scope-demo
echo '{"name":"root","workspaces":["apps/*"]}' > package.json
echo '{"name":"api"}' > apps/api/package.json
echo '{"name":"web"}' > apps/web/package.json
printf 'NODE_ENV=dev\nDATABASE_URL=pg://x\n' > apps/api/.env
printf 'NODE_ENV=dev\nWEB_ONLY=1\n' > apps/web/.env
bun run /Users/nikrabaev/Work/personal/menv/src/index.ts init
bun run /Users/nikrabaev/Work/personal/menv/src/index.ts
```

Expected: the sidebar shows `All` and `Root` at top, then an `APPS` header (dimmed) with `api` / `web`. `tab` into the scopes pane; `↑↓` moves between selectable rows and never lands on the `APPS` header. Selecting `All` lists every variable; `Root` lists only the global-tier shared vars (`NODE_ENV`); `api` lists `NODE_ENV` + `DATABASE_URL`. Switching scope resets the variable cursor to the top.

---

## Self-Review

**Spec coverage (approved design points):**
- True `All` scope (every variable) → Task 1 `varsForScope("all")` + Task 2 default cursor 0. ✅
- `Root` rename of the global-tier pool → Task 1 `buildScopes` + `varsForScope("root")`. ✅
- Section separation (`APPS`/`SERVICES`/`GROUPS` headers, omitted when empty) → Task 1 `buildScopes`; Task 2 ScopeTree header rendering. ✅
- Header rows non-selectable; navigation skips them → Task 1 `stepScope`; Task 2 app `↑↓` handlers. ✅
- Variable cursor resets on scope change → Task 2 app handlers. ✅
- Viewport/height budget preserved (headers are single rows, no blank spacers) → Task 2 ScopeTree windowing unchanged. ✅
- Doc kept in sync → Task 3. ✅

**Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output. ✅

**Type consistency:** `Scope`/`ScopeKind` defined in Task 1 are imported by `ScopeTree.tsx` and `app.tsx` in Task 2; `buildScopes`/`varsForScope`/`stepScope` signatures match their call sites; `Store`/`RepoModel`/`Variable` used unchanged from `src/core/types.ts` and `src/store/store.ts`. ✅

**Out of scope (unchanged):** new-variable tier logic (`All`/`Root` → global, app → local) is preserved as-is; no changes to discovery, store, crypto, or generation.
