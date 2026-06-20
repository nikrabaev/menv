# Global "Reveal Secrets" Toggle

**Date:** 2026-06-17
**Status:** Design, approved by the menv author — pending implementation plan

## Goal

Add a global keybinding to the TUI that toggles session-wide visibility of all
variables flagged `secret` (the values rendered `***` today). Default is hidden.
The first reveal in a session asks for confirmation; once confirmed, the toggle
flips freely for the rest of the session. Hiding never asks.

While secrets are globally revealed, the existing per-value `r` peek
(`startReveal`) is unavailable — it would re-confirm and peek a value already on
screen.

This is **flagged secrets only**: non-secret values are already shown in
plaintext and are unaffected. The toggle changes only the masking layer — it does
not unlock vaults, so a locked vault still shows `⚿ locked` either way.

## Keybinding

- **`ctrl+r`** toggles global reveal. Detected in the global-chord block of
  `handlePaneKey` via `key.ctrl && input === "r"`. No `ctrl` chords exist today,
  so it is free. The global `useInput` is inactive while a modal is open or the
  `/` filter is being typed ([app.tsx:62](../../../src/tui/app.tsx)), so the
  chord is correctly scoped to the pane layer.
- The lowercase `r` peek is unchanged as a keybinding but gated on visibility
  state (see below).

## State

Two new fields on `AppState` ([store.tsx](../../../src/tui/state/store.tsx)),
both default `false`:

- `revealSecrets: boolean` — are flagged secrets currently shown in plaintext?
- `revealConfirmed: boolean` — has the user confirmed a reveal at least once this
  session?

New action:

```ts
| { type: "revealSecrets"; revealed: boolean }
```

Reducer: `revealSecrets = action.revealed`, and
`revealConfirmed = state.revealConfirmed || action.revealed`. Confirming a reveal
latches `revealConfirmed` on; hiding leaves it on. Both reset only when the
process restarts (no persistence).

## Toggle logic

A `toggleReveal(store: Store): void` helper in
[mutations.ts](../../../src/tui/state/mutations.ts), called from the global-chord
block in `handlePaneKey`:

| Current state | Action |
|---|---|
| revealed | dispatch `revealed:false`; status "secrets hidden" |
| hidden + `revealConfirmed` | dispatch `revealed:true` directly; status "secrets revealed — ^r to hide" |
| hidden + not confirmed | push existing `{ kind:"confirm", danger:true }` modal; `onConfirm` dispatches `revealed:true` |

The confirm reuses the existing `confirm` modal kind — no new modal. Confirm copy:
title "Reveal secrets", body "Show all secret values in plaintext across the TUI?
(^r hides them again)".

## Per-value `r` peek becomes unavailable when revealed

Both behavior and the keymap-derived hints are kept truthful:

- **Behavior:** gate `r` on `!state.revealSecrets` in `handleMainKey` (variables
  case, [input.ts:187](../../../src/tui/input.ts)) and `handleInspectorKey`
  ([input.ts:243](../../../src/tui/input.ts)). When revealed, `r` is a no-op that
  sets an info status ("secrets already revealed — ^r to hide").
- **Hints:** thread `revealSecrets` into `footerHints(context, revealSecrets)`
  ([keys.ts](../../../src/tui/keys.ts)) and into `HelpModal`
  ([simpleModals.tsx](../../../src/tui/modals/simpleModals.tsx)) so the
  `{ key: "r", label: "reveal" }` entry is filtered out of the inspector footer
  and the `?` overlay (Variables + Inspector sections) while revealed. The
  variables footer never showed `r` (past the 6-hint cutoff), so only the
  inspector footer and help change.

## Masking integration

Three render sites switch their secret test from `def.secret === true` to
`def.secret === true && !revealSecrets`:

- `inspectorBody` ([inspector.tsx:118](../../../src/tui/views/inspector.tsx)) —
  reads `state`, so also covers the narrow-terminal `DetailModal`, which renders
  `inspectorBody(store.state)`.
- `VarCard` in human mode ([humanVariables.tsx:83](../../../src/tui/views/humanVariables.tsx)) —
  add a `revealed: boolean` prop threaded from `HumanVariablesTab` (`state.revealSecrets`).
- the per-consumer preview in the value-edit modal
  ([valueEditModal.tsx:156](../../../src/tui/modals/valueEditModal.tsx)) — uses
  `store.state.revealSecrets`, so an editor opened while reveal is on stays
  consistent. The modal's own value-input seeding (line 64) is unchanged.

`maskValue` itself ([selectors.ts:243](../../../src/tui/state/selectors.ts)) is
unchanged — each call site computes the effective secret flag.

## Discoverability & safety indicator

- `keys.ts` global context: add `{ key: "^r", label: "reveal secrets" }`. Global
  chords surface in the `?` overlay, not per-context footers (same as
  `g`/`c`/`H`).
- `Header` ([chrome.tsx:14](../../../src/tui/components/chrome.tsx)): render a red
  `Badge` reading "secrets shown" only while `revealSecrets` is true — a
  persistent caution that secret values are visible. Hidden state shows no extra
  chrome.

## Testing

In `tests/tui/` (mirrors `src/tui/`):

- **reducer:** `revealSecrets` action sets the flag; `revealConfirmed` latches on
  reveal and stays true after a subsequent hide.
- **`toggleReveal`:** hidden+unconfirmed pushes a confirm modal (no immediate flag
  change); hidden+confirmed reveals with no modal; revealed → hides with no modal.
- **`ctrl+r` routing:** `handlePaneKey` with `key.ctrl && input==="r"` invokes the
  toggle; a plain `r` does not.
- **peek gating:** with `revealSecrets` true, pressing `r` in the variables and
  inspector contexts pushes no reveal/confirm modal.
- **hint truthfulness:** `footerHints(context, true)` and the help builder omit the
  `r reveal` entry; `footerHints(context, false)` keeps it.

## Out of scope (YAGNI)

- Auto-hide timeout or idle re-masking.
- Persisting reveal state across runs.
- Masking non-secret values (a broader "privacy curtain" mode).
- Changing the per-value `r` peek's own confirm flow.
