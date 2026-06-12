# menv v2 — TUI design (Ink)

**Status:** approved for implementation · **Brief:** `docs/tui/2026-06-13-tui-design-brief.md`
**Stack:** Ink 6 + React 19 + @inkjs/ui, running under Bun, on the v2 core (no new core
semantics — the TUI is a second app layer beside the CLI).

## 1. Goal

A keyboard-first, full-featured interactive TUI (`menv tui`) covering the whole v2
feature inventory: browse/edit structure (vaults, consumers, variables, wiring, groups,
globals, compose), edit values (masked secrets, deliberate reveal), and run the
repo-level lifecycle (init, import, generate, check, backup/restore) — all through the
same plan → confirm → apply contract the CLI exposes as `--dry-run`/`--force`.

## 2. Approaches considered

1. **IDE three-panel (chosen)** — sidebar (scopes: vaults + consumers) · main (tabbed
   entity lists, variables first) · inspector (detail of the selection). The heart of
   menv is the variable × vault × consumer relationship; this keeps all three axes on
   screen at once: the sidebar *is* the vault/consumer axis, the main list is the
   variable axis, the inspector is the cell detail. Degrades to two panes at <110 cols.
2. **Drill-down stack (k9s-style)** — `:vaults`, `:vars`… One resource at a time;
   degrades best on narrow terminals, but hides the three-way relationship behind
   navigation, which fights the brief's "make the model legible" requirement.
3. **Matrix-first** — a literal variables × consumers grid as the main screen. Most
   direct rendering of the wiring relationship, but collapses badly with >4 consumers
   and makes every other entity a second-class modal.

Choice 1 with the inspector carrying the per-variable wiring matrix gives 3's
legibility without its scaling problem, and 2's detail-on-enter as the narrow fallback.

## 3. Layout

```
┌ menv · <repo> · vault: local (default · encrypted · unlocked) · consumer: all ┐
│ [1] SCOPES        │ [2] Variables · Globals · Groups · Compose · Backups      │
│ VAULTS            │ filter: /dat… (3/24)                    │ [3] INSPECTOR   │
│ › local    E+ *   │ ── Database ───────────                 │ DATABASE_URL    │
│   prod     E-     │ ▌DATABASE_URL  S  api● web◆             │ secret · db     │
│ CONSUMERS         │  DB_POOL_SIZE     api◌ web·             │ wiring in local │
│   api             │ ── (ungrouped) ────────                 │ ▸ api  ● ***    │
│   web             │  API_URL          api● web●             │   web  ◆ shared │
├───────────────────┴─────────────────────────────────────────┴─────────────────┤
│ ⚠ outputs stale — press g to generate            ✖2 ⚠1 (c to view) · spinner  │
│ ↑↓ move · ⏎ inspect · w wire · s set · g generate · c check · ? help · q quit │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Header**: repo name, active vault + its states, consumer filter. Persistent context.
- **Pane 1 — Scopes** (sidebar, ~24 cols): VAULTS list then CONSUMERS list as one
  focusable pane. Selecting a vault row + Enter sets the **active vault** (= the
  environment = generation context — rule 2 of the brief). Selecting a consumer +
  Enter toggles the **consumer filter**. Entity management happens here (`a`/`e`/`x`,
  `u` unlock, `D` set default).
- **Pane 2 — Main**: tabs `Variables · Globals · Groups · Compose · Backups`, cycled
  with `[` / `]`. Variables is the default tab: grouped by registry groups (titles as
  section headers, ungrouped last), each row shows name, `S` secret marker, and a
  per-consumer wiring chip for the active vault.
- **Pane 3 — Inspector**: read/detail surface for the current selection (variable →
  definition + full wiring matrix with masked values; vault/consumer/global → its
  config). Focusable: in a variable's wiring matrix, `j`/`k` selects a (vault,
  consumer) row and `s`/`r`/`d`/`u`/`w` act on that cell.
- **Status line**: ephemeral action feedback (auto-fades) + persistent health summary
  (`✖n ⚠m` from the last check, stale hint) + busy spinner.
- **Footer**: 5–8 context-sensitive hints for the focused pane; full reference on `?`.

### Responsive plan (the floor)

- **≥110 cols**: three panes (sidebar 24 · main flex · inspector 36–42).
- **80–109 cols**: sidebar + main; the inspector becomes a detail **modal** on Enter
  (detail-on-enter is the universal escape hatch).
- **<80 cols or <20 rows**: clean "terminal too small — menv tui needs ≥80×20" screen.
- Resize is handled continuously (Ink re-renders on `stdout` resize); no absolute
  positions anywhere — Yoga flex only.

### State encodings (color always paired with a glyph/letter)

| State | Encoding |
|---|---|
| wiring: wired + value | `●` green |
| wiring: wired, missing value | `◌` red |
| wiring: shared key (2+ consumers) | `◆` (green/red by value presence) |
| wiring: disabled (commented out) | `#` dim |
| wiring: unwired | `·` dim |
| secret variable | `S` magenta (values render `***`) |
| vault encrypted / plaintext | `E` cyan / `P` yellow |
| vault locked / unlocked | `-` red / `+` green (suffix on E/P) |
| default vault | `*` after name |
| active vault | `›` prefix + bold |
| finding error / warning | `✖` red / `⚠` yellow |
| generated file managed / foreign / stale | normal / `!foreign` red / `~stale` yellow |

Legend lives in the `?` help overlay. Everything must read in monochrome (`NO_COLOR`).

## 4. Keybindings (single source: `src/tui/keys.ts` drives footer + help)

Hybrid modeless: arrows **and** `hjkl`, context-sensitive single letters per focused
pane, footer always shows the current pane's verbs. Reserved keys untouched (Ctrl+C
quits via Ink, no Ctrl+S/Q/Z bindings).

- **Global**: `q` quit (confirm modal) · `?` help · `/` filter focused list · `Esc`
  clear filter / close modal · `Tab`/`Shift+Tab` + `1` `2` `3` pane focus · `[` `]`
  main tabs · `g` generate · `c` check · `i` import · `R` reload from disk.
- **Sidebar / vault row**: `Enter` set active · `u` unlock (masked passphrase) · `a`
  add · `e` edit config · `x` remove · `D` set default.
- **Sidebar / consumer row**: `Enter` toggle filter · `a` add · `e` edit · `x` remove.
- **Variables tab**: `n` define · `e` edit definition · `x` remove · `w` wire · `u`
  unwire · `d` enable/disable · `s` set value · `r` reveal value · `Enter` inspect.
- **Globals tab**: `n` define · `e` edit (per active vault: runtime/static) · `x` remove.
- **Groups tab**: `n` add · `e` edit title · `x` remove.
- **Compose tab**: `n` bind file · `x` unbind.
- **Backups tab**: `n` backup now · `Enter` restore (confirm).
- **Lists**: `j/k`/arrows move, `PgUp/PgDn/Home/End`, filter shows `(n/total)` count.

(`gg`/`G` are deliberately sacrificed: `g` = generate is a top-3 action; Home/End cover
jump-to-edge.)

## 5. Architecture

```
src/tui/
  index.ts          runTui(root, opts): TTY guard, render(<App/>), await exit
  app.tsx           providers, size guard, init-wizard vs main routing, modal host
  theme.ts          semantic color tokens (ANSI names only — user theme is sacred)
  keys.ts           keymap registry (context → bindings) → footer hints + help overlay
  state/
    store.tsx       AppState + reducer + React context (no external state dep)
    data.ts         loaders: registry, per-vault value snapshot, findings, backups
    mutations.ts    the TUI's runMutation: plan → (modal) → executePlan → refresh
    selectors.ts    pure derivations: cell states, shared keys, grouped+filtered rows
  components/       Pane, ScrollList (virtualized), Tabs, KeyHints, StatusBar,
                    Modal, FormField, PlanView, FindingsList, ValueCell, Badge
  views/            sidebar, variables, globals, groups, compose, backups, inspector,
                    initWizard
  modals/           planConfirm, varForm, wireForm, unwireForm, valueForm, revealView,
                    vaultForm, consumerForm, groupForm, globalForm, composeBind,
                    importForm, generateFlow, restoreConfirm, unlockVault, confirm,
                    consumerPick (AMBIGUOUS resolution), help, quit
```

### Reuse of the v2 core (no duplication)

- Registry: `loadRegistry`/`saveRegistry`. Ops: every `plan*` planner (they already
  return `{ next, plan }` with blockers/warnings). Execution: `executePlan` with
  `commitRegistry` + `applyFileOp`.
- Sessions/auth: `openVaultSession` + `collectValueRecords` from `src/cli/run.ts`
  (already Io-free). The TUI keeps an **in-memory auth map** (never persisted);
  `AUTH_MISSING`/`AUTH_FAILED` surface as the unlock modal, then retry.
- Generate: `vaultsNeeded` + `previewGenerate` + `previewCompose` + `applyPreview` —
  the TUI shows the preview as the confirm step and applies the *same* preview (no
  recompute between preview and apply).
- Check: **small refactor** — extract `collectFindings(root, registry, auth):
  Promise<Finding[]>` from `runCheck` (and export `Finding`); `runCheck` becomes a
  thin CLI wrapper. This is the only core/CLI change the TUI needs.
- Import: `parseDotenv` + `planImportEntries`. Backups: `io/backup.ts` directly.
- Ambiguity: `resolveMappingKey`'s `AMBIGUOUS` error → consumer-pick modal, never a guess.

### State & data flow

Single `useReducer` store in context. `AppState`: registry + root, activeVault,
consumerFilter, pane focus, main tab, per-list selection/filter, `vaultStatus`
(per vault: locked/unlocked/plaintext), `values` (per unlocked vault: key → value
snapshot, refreshed after mutations), `findings` (last check + timestamp), modal stack,
status message, busy flag.

Async actions (unlock, check, generate, apply, restore) are plain async functions that
dispatch start/finish; all I/O stays out of components. **After every successful
apply**: reload the registry from disk, refresh the affected vault snapshot(s), and
re-run `collectFindings` in the background (with in-memory auth; locked vaults degrade
to `UNVERIFIED_VAULT`) so the header/status drift indicators stay honest. Startup runs
the same background check once — without prompting for any passphrase.

### The plan → confirm → apply modal (dominant interaction)

Every mutation routes through one component: planner output rendered as sections —
registry ops (dotted path + summary), vault ops (**keys only — values are never
rendered**, mirroring `planToJson`), file ops, warnings (`⚠`), blockers (`✖`).
`Enter` applies (disabled while blockers exist) · `Esc` cancels · `f` arms force, which
re-labels the apply action in red ("apply anyway — leaves dangling refs") and requires
a second `Enter`. Empty plan → "no changes" notice. Destructive flows (remove ×,
`--delete-files`, restore-overwrite, force) always carry consequence text.

### Secrets & auth behavior

Masked `***` in every list/inspector/plan; `set` for a secret uses a masked input;
`r` reveal is per-value, behind an explicit confirm, shown until Esc/selection move,
never written to state history. Unlock modal input is masked; passphrases live only in
the in-memory auth map for the session.

## 6. Entry point & distribution

`menv tui` subcommand in `program.ts`; the action lazily `await import`s `src/tui` so
CLI startup cost is unchanged. Guards: requires a TTY (exit 2 otherwise); no registry →
the init wizard (encrypted/plaintext choice; v1 `menv.toml` → the existing VALIDATION
error). Completions pick the command up automatically (live commander-tree walk).
README gains the `tui` command + a short section. New deps: `ink`, `react`, `@inkjs/ui`;
dev: `ink-testing-library`, `@types/react`. tsconfig is already `react-jsx`.

## 7. Error handling

- `MenvError` from any action → status line (`✖ code: message`) or inline in the open
  modal; never a crash, never a stack trace on screen.
- Vault auth errors → unlock modal (retry loop, `Esc` to give up → vault stays locked,
  features degrade exactly like `check`'s UNVERIFIED_VAULT).
- Unexpected errors → Ink unmounts cleanly (terminal restored), error printed after
  exit, exit code 1.
- Quit (`q`/Ctrl+C) closes all open vault sessions before exit.

## 8. Testing

`bun:test` + `ink-testing-library`, `tests/tui/` mirroring `src/tui/`:

- **Pure**: selectors (cell states incl. shared/disabled/missing, grouping, filtering),
  keymap → footer/help derivation.
- **Component frames**: navigation & focus, tab cycling, filter counts, masked secrets
  in lists/inspector, plan modal renders keys-not-values, blocker disables apply +
  force arming, too-small screen, empty states with next-step hints.
- **Disk (`.disk.test.ts`)**: against `tmpRepo` fixtures — full wire/set/generate
  round-trip writes real files; unlock flow against an encrypted vault fixture;
  check surfaces findings; restore round-trip.
- Existing suite (245 tests) must stay green; `collectFindings` extraction is covered
  by the existing check tests plus one new direct unit test.

## 9. Out of scope (per brief §10)

Remote vault providers (UI accommodates multiple `vaultType`s in vault add/list, but
only `menv-local` is offered), `menv run`/`apply`/`diff`, multi-line values, value
history, shell completions UI, mouse support (keyboard-first; Ink mouse is roadmap),
theming config files (semantic ANSI tokens only in v1 of the TUI).
