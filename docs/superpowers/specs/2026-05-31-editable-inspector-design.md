# Editable Inspector — Copy Value, Edit Description, Edit Example

**Date:** 2026-05-31
**Status:** Approved, ready for implementation plan

## Problem

The TUI can edit a variable's per-env value (`enter` → `EditValueModal`) but offers no
way to:

- **Copy a value** to the system clipboard.
- **Change a variable's description.**
- **Change a variable's example value** (the placeholder emitted into `.env.example`).

Meanwhile the inspector (`src/ui/components/Inspector.tsx`) is a passive, plain
`key value` read-only pane that the user finds neither useful nor attractive.

The store already exposes `setDescription`, `setGroup`, `toggleSecret`, and `wire`, but
`setDescription`/`setGroup` are wired to **no UI**, and there is **no `setExample`** at
all. The `description`, `group`, and `example` fields already round-trip through the
manifest (`src/io/persist.ts`), and `example` already feeds `.env.example` generation
(`src/io/generate.ts`).

## Decision

Turn the inspector into a **focusable, navigable, editable third pane** — the single
editing hub for a variable. This directly fixes "the inspector isn't useful" by making
it the edit surface, keeps the existing fast path (`enter` in the variable list still
edits the current-env value), and avoids piling more keys onto an already-crowded hint
bar.

Two confirmed choices from brainstorming:

- **Comprehensive field set** — the inspector navigates/edits description, example,
  group, secret, wiring, and each per-env value. `secret` and `wire` move *out* of the
  global hint bar and become inspector fields.
- **Cross-platform clipboard** — detect the platform and shell out to the right tool.

One deliberate scope cut (YAGNI): **`tier` is displayed but not editable.** Switching
global↔local requires reassigning `ownerApp` and is out of scope for this request.

## Inspector UX

The inspector renders a **flat label/value list** (easy to read, trivial to window):

```
╭─ DATABASE_URL · global ───────────────────────╮
│ ▸ description  Postgres connection string      │   ← ▸ = inspector cursor (focused only)
│   example      postgres://user:pass@host/db     │
│   group        db                               │
│   secret       no                               │
│   wiring       api · worker                      │
│   dev          postgres://localhost:5432/app     │   ← one row per environment value
│   prod         ••••••••                          │   ← secret values stay masked
╰ ↑↓ field · ⏎ edit · c copy · esc back ──────────╯
```

- **Title** shows `name · tier` (tier read-only here).
- **Unfocused:** same layout, dim labels, no `▸`, no row highlight — a prettier
  read-only view. The footer hint line only appears when focused.
- **Focused** (reached via `tab`): the selected field shows `▸` plus a full-row
  highlight (matching `VariableList`'s `active && idx === cursor` idiom — border stays
  gray for consistency).
- Long values truncate with a single-cell `…` (reuse `VariableList`'s `truncate`).
- Secret values render masked (`•••` / `***`) on screen regardless of focus.
- The flat field list is **windowed with the existing `listWindow` helper** so it never
  overflows `paneHeight` and never violates the layout-budget invariant
  (`MoreIndicator` above/below, same as `VariableList`/`WireModal`).
- The inspector is focusable **only when a variable is selected**. With no selection,
  `tab` cycles scopes ⇄ vars as today and the inspector shows its "select a variable"
  placeholder.

The inspector keeps its current fixed width (60).

## Field model

A new **pure** helper `inspectorFields(model, variable)` lives in `src/ui/`
(alongside `scopes.ts`) and returns the ordered field descriptors. Both `app.tsx`
(for actions) and `Inspector.tsx` (for rendering) consume it — one source of truth,
unit-testable in isolation.

Field order and behavior:

| # | Field            | `enter`                          | `c` (copy)             |
|---|------------------|----------------------------------|------------------------|
| 0 | description      | open `EditFieldModal`            | copy text              |
| 1 | example          | open `EditFieldModal`            | copy text              |
| 2 | group            | open `EditFieldModal`            | copy text              |
| 3 | secret           | `store.toggleSecret` (in place)  | — (no-op)              |
| 4 | wiring           | open `WireModal` (existing)      | — (no-op)              |
| 5… | value (per env) | open `EditFieldModal` (that env) | copy that env's value  |

Descriptor shape (illustrative):

```ts
type InspectorField =
  | { kind: "description" | "example" | "group"; label: string; text: string }
  | { kind: "secret"; label: "secret"; on: boolean }
  | { kind: "wiring"; label: "wiring"; summary: string }
  | { kind: "value"; label: string /* env id */; env: string; text: string; secret: boolean };
```

- `group` displays `-` when `null`; editing it to empty sets it back to `null`.
- `example` editing to empty clears it (`undefined`).
- `wiring`'s `summary` reuses the existing consumer-name join.

## Interaction & keys

- `tab` cycles **scopes → vars → inspector → scopes** (skipping inspector when no
  variable is selected).
- **vars pane** (fast paths preserved):
  - `enter` → edit the current-env value (`editTarget = { kind: "value", env }`).
  - `c` → copy the current-env value.
- **inspector pane:**
  - `↑↓` → move the inspector cursor over the field list.
  - `enter` → edit / toggle / wire per the field table.
  - `c` → copy per the field table.
  - `esc` → unfocus back to the vars pane.
- `d` (secret toggle) and `w` (wire) are **removed from the global hint bar** — they are
  now inspector fields. `x` (delete) stays global (whole-variable op, not a field).
  `e` (cycle env), `n` (new), `/` (filter), `s` (save), `q` (quit) stay global.
- The footer hint line becomes **context-aware**: a vars-pane variant and an
  inspector-pane variant.

### Edit modal

`EditValueModal` is generalized into `EditFieldModal` — same hand-rolled `useInput`
pattern (the repo's existing idiom; `ink-text-input` is a dep but unused), **same 5-row
rendered height** so the `bottomHeight` layout budget is unchanged. New props:

- `label: string` — e.g. `value · prod`, `description`, `example`, `group`.
- `initial: string`, `onSubmit(value)`, `onCancel()`.

`app.tsx` holds an `editTarget` state:

```ts
type EditTarget =
  | { kind: "value"; env: string }
  | { kind: "description" }
  | { kind: "example" }
  | { kind: "group" };
```

On submit, `app.tsx` dispatches to the matching store method:
`value → setValue(id, env, v)`, `description → setDescription(id, v)`,
`example → setExample(id, v)`, `group → setGroup(id, v.trim() || null)`.

Toggle (`secret`) and wiring don't use the modal — `secret` calls `toggleSecret`
immediately; `wiring` enters the existing `wire` mode/overlay.

## Clipboard

New module `src/io/clipboard.ts`:

- `clipboardCommand(platform): string[] | null` — **pure**, unit-tested directly:
  - `darwin` → `["pbcopy"]`
  - `linux` → `["wl-copy"]` with `["xclip", "-selection", "clipboard"]` fallback
    (selection of the concrete strategy is an implementation detail; the helper exposes
    the candidate command(s))
  - `win32` → `["clip"]`
  - otherwise → `null`
- `copyToClipboard(text): Promise<boolean>` — thin `Bun.spawn` wrapper mirroring
  `src/crypto/identity.ts`: pipe `text` into the child's stdin, `await p.exited`, return
  `false` on a missing tool / non-zero exit.

`MenvApp` accepts an optional `copy` prop defaulting to `copyToClipboard` — the same
injection pattern as `onSaveStamp` — so tests pass a spy. The status line confirms
`copied DATABASE_URL (prod)` on success or `clipboard unavailable` on failure.

Copying a **secret** value is allowed by design: it stays masked on screen, but the
real value lands on the clipboard (the point of having it).

## Store & persistence

- Add `setExample(varId, example: string)` to `Store` (empty string → `example:
  undefined`), implemented via the existing `mapVar` helper.
- `setDescription` and `setGroup` already exist — no change.
- **No changes to `save.ts` / `persist.ts`** — `description`, `group`, and `example`
  already serialize to the manifest, and `example` already feeds `.env.example`
  generation on save.

## Files touched

| File | Change |
|---|---|
| `src/ui/components/Inspector.tsx` | Rewrite: focusable flat field list, windowed, masked secrets, truncation. |
| `src/ui/inspectorFields.ts` | **New** — pure field-descriptor helper. |
| `src/ui/app.tsx` | 3-pane `tab` cycle, inspector cursor state, `editTarget`, `c` handling, `copy` prop, context-aware footer; remove `d`/`w` globals. |
| `src/ui/components/EditFieldModal.tsx` | Generalized from `EditValueModal` (add `label`). |
| `src/io/clipboard.ts` | **New** — `clipboardCommand` (pure) + `copyToClipboard`. |
| `src/store/store.ts` | Add `setExample`. |

## Testing (bun:test, TDD)

Pure logic first, then components.

- `tests/ui/inspectorFields.test.ts` — field order, kinds, `group` null display,
  per-env value rows, secret masking flag.
- `tests/io/clipboard.test.ts` — `clipboardCommand` mapping per platform incl. unknown
  → `null`.
- `tests/store/store.test.ts` — `setExample` sets and clears (empty → undefined);
  marks dirty.
- `tests/ui/components/inspector.test.tsx` — focused render shows `▸` + highlight,
  unfocused has neither; masked secret rows; windowing with many envs; truncation.
- `tests/ui/editField.test.tsx` — generalized modal renders `label`, submits/cancels
  (supersedes `editValue.test.tsx`).
- `tests/ui/app.test.tsx` (extend) — `tab` reaches inspector only with a selection;
  `↑↓` moves the inspector cursor; `enter` on description/example/group opens the modal
  with the right label and persists via the store; `enter` on secret toggles; `enter`
  on wiring opens `WireModal`; `c` invokes the injected `copy` spy with the right text
  and sets the status line (success and `clipboard unavailable`).

Follow the project's Ink testing conventions: pass `viewportRows`/`viewportColumns`,
drive input with `stdin.write(...)` then `await` a short `setTimeout` before reading
`lastFrame()`, and judge correctness by line count / closing borders (not stray
bleed-through, which is a debug-mode artifact).

## Layout-budget note

Editing any field uses `mode === "edit"` with the existing `bottomHeight = 5`
(`EditFieldModal` keeps the 5-row shape). Wiring reuses the existing full-area `wire`
takeover. Copy and secret-toggle stay in `browse` mode and only update the status line.
So the `topBar(3) + paneHeight + bottomHeight = rows` invariant is preserved, and the
inspector's own windowing keeps it within `paneHeight`.
