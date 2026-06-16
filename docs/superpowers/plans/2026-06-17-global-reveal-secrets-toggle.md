# Global Reveal-Secrets Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `ctrl+r` toggle to the TUI that reveals/hides every variable flagged `secret`, confirmed once per session; while revealed, the per-value `r` peek is unavailable.

**Architecture:** A session-wide `revealSecrets` flag (plus a latched `revealConfirmed`) lives in the existing reducer. A `toggleReveal` mutation flips it (pushing the existing `confirm` modal on the first reveal). Three render sites factor the flag into their secret test; the keymap/footer/help and a header badge reflect the current state.

**Tech Stack:** Bun, TypeScript (strict), Ink/React TUI, `bun:test` + `ink-testing-library`.

---

### Task 1: Reveal state in the reducer

**Files:**
- Modify: `src/tui/state/store.tsx` (AppState, initialState, Action, reducer)
- Test: `tests/tui/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/tui/store.test.ts`:

```ts
describe("reducer · reveal secrets", () => {
  test("reveal flags default off", () => {
    const s = base();
    expect(s.revealSecrets).toBe(false);
    expect(s.revealConfirmed).toBe(false);
  });

  test("revealing sets both flags; hiding keeps the session confirmation", () => {
    let s = base();
    s = reducer(s, { type: "revealSecrets", revealed: true });
    expect(s).toMatchObject({ revealSecrets: true, revealConfirmed: true });
    s = reducer(s, { type: "revealSecrets", revealed: false });
    expect(s).toMatchObject({ revealSecrets: false, revealConfirmed: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tui/store.test.ts`
Expected: FAIL — `revealSecrets`/`revealConfirmed` are not on the state and the `revealSecrets` action type is unknown.

- [ ] **Step 3: Add the state fields**

In `src/tui/state/store.tsx`, in the `AppState` interface, after `humanRowIndex: number;` add:

```ts
  revealSecrets: boolean; // session-wide: show flagged secrets in plaintext
  revealConfirmed: boolean; // user confirmed a reveal at least once this session
```

In `initialState`, after `humanRowIndex: 0,` add:

```ts
    revealSecrets: false,
    revealConfirmed: false,
```

In the `Action` union, after `| { type: "humanRowIndex"; index: number }` add:

```ts
  | { type: "revealSecrets"; revealed: boolean }
```

In `reducer`, after the `case "humanRowIndex":` block add:

```ts
    case "revealSecrets":
      return {
        ...state,
        revealSecrets: action.revealed,
        revealConfirmed: state.revealConfirmed || action.revealed,
      };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tui/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/state/store.tsx tests/tui/store.test.ts
git commit -m "feat(tui): reveal-secrets state in the reducer"
```

---

### Task 2: Keymap entry + reveal-aware hint filtering

**Files:**
- Modify: `src/tui/keys.ts` (global keymap, new `contextHints`, `footerHints` signature)
- Test: `tests/tui/keys.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/tui/keys.test.ts`, change the import line to add `contextHints`:

```ts
import { contextHints, footerHints, HELP_SECTIONS, KEYMAP } from "../../src/tui/keys.ts";
```

Append:

```ts
describe("reveal suppresses the peek hint", () => {
  test("contextHints drops r when secrets are revealed", () => {
    expect(contextHints("inspector", true).some((h) => h.key === "r")).toBe(false);
    expect(contextHints("inspector", false).some((h) => h.key === "r")).toBe(true);
    expect(contextHints("variables", true).some((h) => h.key === "r")).toBe(false);
  });

  test("footerHints honors the reveal flag", () => {
    expect(footerHints("inspector", true).some((h) => h.key === "r")).toBe(false);
    expect(footerHints("inspector").some((h) => h.key === "r")).toBe(true);
  });

  test("ctrl+r is registered as a global chord", () => {
    expect(KEYMAP.global.some((h) => h.key === "^r")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tui/keys.test.ts`
Expected: FAIL — `contextHints` is not exported and `^r` is not in `KEYMAP.global`.

- [ ] **Step 3: Implement the keymap entry and filter**

In `src/tui/keys.ts`, add the global chord. In the `global` array, after the `{ key: "H", label: "human mode" }` line add:

```ts
    { key: "^r", label: "reveal secrets" },
```

Replace the existing `footerHints` function with a `contextHints` helper plus a reveal-aware `footerHints`:

```ts
// Hints for a context with runtime suppressions applied. While secrets are
// globally revealed, the per-value `r` peek is unavailable, so its hint is
// dropped from the contexts that offer it.
export function contextHints(context: KeyContext, revealSecrets = false): KeyHint[] {
  const hints = KEYMAP[context];
  if (revealSecrets && (context === "variables" || context === "inspector")) {
    return hints.filter((h) => h.key !== "r");
  }
  return hints;
}

// The 3–8 hints shown in the footer for a focused context (global tail kept short).
export function footerHints(context: KeyContext, revealSecrets = false): KeyHint[] {
  const own = contextHints(context, revealSecrets).slice(0, 6);
  return [...own, { key: "?", label: "help" }, { key: "q", label: "quit" }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tui/keys.test.ts`
Expected: PASS (including the existing footer/global conventions tests).

- [ ] **Step 5: Commit**

```bash
git add src/tui/keys.ts tests/tui/keys.test.ts
git commit -m "feat(tui): register ^r and reveal-aware hint filtering"
```

---

### Task 3: `toggleReveal` mutation

**Files:**
- Modify: `src/tui/state/mutations.ts` (add `toggleReveal`)
- Test: `tests/tui/reveal.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/tui/reveal.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { toggleReveal } from "../../src/tui/state/mutations.ts";
import type { Action, AppState, Store } from "../../src/tui/state/store.tsx";
import { initialState, reducer } from "../../src/tui/state/store.tsx";
import { makeRegistry } from "../helpers/fixtures.ts";

function makeStore(overrides: Partial<AppState> = {}): Store {
  let state: AppState = { ...initialState(makeRegistry()), ...overrides };
  return {
    get state() {
      return state;
    },
    getState: () => state,
    dispatch: (action: Action) => {
      state = reducer(state, action);
    },
  };
}

describe("toggleReveal", () => {
  test("first reveal asks for confirmation and does not reveal yet", () => {
    const store = makeStore();
    toggleReveal(store);
    expect(store.state.revealSecrets).toBe(false);
    const top = store.state.modals.at(-1);
    expect(top?.kind).toBe("confirm");
    if (top?.kind === "confirm") {
      expect(top.title).toBe("Reveal all secrets");
      void top.onConfirm();
      expect(store.state.revealSecrets).toBe(true);
      expect(store.state.revealConfirmed).toBe(true);
    }
  });

  test("after confirming once, reveal is immediate with no modal", () => {
    const store = makeStore({ revealConfirmed: true });
    toggleReveal(store);
    expect(store.state.revealSecrets).toBe(true);
    expect(store.state.modals).toHaveLength(0);
  });

  test("hiding never asks", () => {
    const store = makeStore({ revealSecrets: true, revealConfirmed: true });
    toggleReveal(store);
    expect(store.state.revealSecrets).toBe(false);
    expect(store.state.modals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tui/reveal.test.ts`
Expected: FAIL — `toggleReveal` is not exported from `mutations.ts`.

- [ ] **Step 3: Implement `toggleReveal`**

In `src/tui/state/mutations.ts`, immediately before the `export function startReveal(` line, add:

```ts
// Global session-wide reveal of all flagged secrets. Hiding never asks; the
// first reveal of the session asks for confirmation, after which revealConfirmed
// is latched on and the toggle flips freely. It changes only the masking layer —
// it does not unlock vaults.
export function toggleReveal(store: Store): void {
  const state = store.getState();
  if (state.revealSecrets) {
    store.dispatch({ type: "revealSecrets", revealed: false });
    setStatus(store, "info", "secrets hidden");
    return;
  }
  const reveal = (): void => {
    store.dispatch({ type: "revealSecrets", revealed: true });
    setStatus(store, "info", "secrets revealed — ^r to hide");
  };
  if (state.revealConfirmed) {
    reveal();
    return;
  }
  store.dispatch({
    type: "pushModal",
    modal: {
      kind: "confirm",
      title: "Reveal all secrets",
      body: "Show every secret value in plaintext across the TUI? (^r hides them again)",
      danger: true,
      onConfirm: reveal,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tui/reveal.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/state/mutations.ts tests/tui/reveal.test.ts
git commit -m "feat(tui): toggleReveal mutation with once-per-session confirm"
```

---

### Task 4: `ctrl+r` routing, `r`-peek gating, test rig constant

**Files:**
- Modify: `src/tui/input.ts` (global chord + gate the `r` peek in two handlers)
- Modify: `tests/tui/helpers.tsx` (export `CTRL_R`)
- Test: `tests/tui/reveal.disk.test.tsx` (new)

- [ ] **Step 1: Add the test rig constant**

In `tests/tui/helpers.tsx`, after the `export const TAB = "\t";` line add:

```ts
export const CTRL_R = "\u0012"; // ctrl+r (DC2) — Ink decodes to { input: "r", ctrl: true }
```

- [ ] **Step 2: Write the failing test**

Create `tests/tui/reveal.disk.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { CTRL_R, renderApp, tick } from "./helpers.tsx";

describe("global reveal — behavior", () => {
  test("ctrl+r confirms once, then flips freely", async () => {
    const rig = await renderApp();
    await rig.type(CTRL_R);
    await tick(25);
    expect(rig.frame()).toContain("Reveal all secrets"); // confirm modal
    await rig.type("y");
    await tick(25);
    expect(rig.frame()).toContain("secrets revealed"); // status

    await rig.type(CTRL_R); // hide — no confirm
    await tick(25);
    expect(rig.frame()).toContain("secrets hidden");
    expect(rig.frame()).not.toContain("Reveal all secrets");

    await rig.type(CTRL_R); // reveal again — confirmed already, no modal
    await tick(25);
    expect(rig.frame()).not.toContain("Reveal all secrets");
    expect(rig.frame()).toContain("secrets revealed");
    rig.ui.unmount();
  });

  test("the per-value r peek is unavailable while revealed", async () => {
    const rig = await renderApp();
    await rig.type(CTRL_R);
    await tick(25);
    await rig.type("y"); // revealed + confirmed
    await tick(25);
    await rig.type("r"); // attempt the peek
    await tick(25);
    expect(rig.frame()).not.toContain("Reveal secret"); // no peek confirm modal
    expect(rig.frame()).toContain("already revealed"); // info status instead
    rig.ui.unmount();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/tui/reveal.disk.test.tsx`
Expected: FAIL — `ctrl+r` does nothing (no global handler), so no confirm modal appears.

- [ ] **Step 4: Wire the global chord and gate the peek**

In `src/tui/input.ts`, add `toggleReveal` to the import from `./state/mutations.ts` (keep the list alphabetical — insert between `toggleDisabled` and `vaultRemove`):

```ts
  toggleDisabled,
  toggleReveal,
  vaultRemove,
```

In `handlePaneKey`, immediately after `const state = store.getState();` and the `// global chords first` comment, before the `if (input === "q")` block, add:

```ts
  if (key.ctrl && input === "r") {
    toggleReveal(store);
    return;
  }
```

In `handleMainKey`, in the `variables` case, replace this line:

```ts
      else if (input === "r") startReveal(store, ctx, name, state.activeVault, consumer);
```

with:

```ts
      else if (input === "r") {
        if (state.revealSecrets) setStatus(store, "info", "secrets already revealed — ^r to hide");
        else startReveal(store, ctx, name, state.activeVault, consumer);
      }
```

In `handleInspectorKey`, replace this line:

```ts
    else if (input === "r") startReveal(store, ctx, name, row.vault, row.consumer);
```

with:

```ts
    else if (input === "r") {
      if (state.revealSecrets) setStatus(store, "info", "secrets already revealed — ^r to hide");
      else startReveal(store, ctx, name, row.vault, row.consumer);
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/tui/reveal.disk.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tui/input.ts tests/tui/helpers.tsx tests/tui/reveal.disk.test.tsx
git commit -m "feat(tui): ctrl+r global reveal toggle, gate the r peek when revealed"
```

---

### Task 5: Honor the flag at the masking render sites

**Files:**
- Modify: `src/tui/views/inspector.tsx:118`
- Modify: `src/tui/views/humanVariables.tsx` (VarCard prop + call site + mask)
- Modify: `src/tui/modals/valueEditModal.tsx:156`
- Test: `tests/tui/reveal.disk.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/tui/reveal.disk.test.tsx`:

```tsx
describe("global reveal — masking", () => {
  test("ctrl+r unmasks secret values in the inspector, then re-masks", async () => {
    const rig = await renderApp(undefined, {
      "k-db": "SHORTSECRET",
      "k-api": "https://api.example.com",
    });
    expect(rig.frame()).toContain("***"); // DATABASE_URL masked in the inspector
    expect(rig.frame()).not.toContain("SHORTSECRET");

    await rig.type(CTRL_R);
    await tick(25);
    expect(rig.frame()).not.toContain("SHORTSECRET"); // still masked behind the confirm
    await rig.type("y");
    await tick(25);
    expect(rig.frame()).toContain("SHORTSECRET"); // revealed
    expect(rig.frame()).not.toContain("***");

    await rig.type(CTRL_R); // hide again
    await tick(25);
    expect(rig.frame()).not.toContain("SHORTSECRET");
    expect(rig.frame()).toContain("***");
    rig.ui.unmount();
  });
});
```

Note: `renderApp(undefined, …)` keeps the default `tuiRegistry()` (where `DATABASE_URL` is the selected secret) while overriding vault values; `SHORTSECRET` (11 chars) survives the inspector's 18-char truncation.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tui/reveal.disk.test.tsx`
Expected: FAIL — after `y`, the frame still shows `***`; the render sites ignore `revealSecrets`.

- [ ] **Step 3: Update the inspector**

In `src/tui/views/inspector.tsx`, change the masked-value line (currently around line 118) from:

```ts
              : maskValue(def.secret === true, row.cell.key !== undefined ? rt.values?.[row.cell.key] : undefined);
```

to:

```ts
              : maskValue(
                  def.secret === true && !state.revealSecrets,
                  row.cell.key !== undefined ? rt.values?.[row.cell.key] : undefined,
                );
```

- [ ] **Step 4: Update the human-mode card**

In `src/tui/views/humanVariables.tsx`, add `revealed` to the `VarCard` destructure (after `cardIndex,`):

```ts
  cardIndex,
  revealed,
  width,
```

Add it to the prop type (after the `cardIndex: number; // …` line):

```ts
  cardIndex: number; // this card's ordinal among cards (for zebra striping)
  revealed: boolean; // global reveal: show flagged secrets in plaintext
  width: number;
```

Change the masked-value line (currently line 83) from:

```ts
            row.hasValue === undefined ? "⚿ locked" : maskValue(secret, row.value);
```

to:

```ts
            row.hasValue === undefined ? "⚿ locked" : maskValue(secret && !revealed, row.value);
```

In `HumanVariablesTab`, pass the flag at the `<VarCard … />` call site, after `cardIndex={cardOrdinals[idx] ?? 0}`:

```tsx
            cardIndex={cardOrdinals[idx] ?? 0}
            revealed={state.revealSecrets}
            width={width}
```

- [ ] **Step 5: Update the value-edit preview**

In `src/tui/modals/valueEditModal.tsx`, change the preview line (currently line 156) from:

```ts
            const preview = o.value === undefined ? "∅" : secret ? "***" : truncate(o.value, 28);
```

to:

```ts
            const preview =
              o.value === undefined ? "∅" : secret && !store.state.revealSecrets ? "***" : truncate(o.value, 28);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/tui/reveal.disk.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/tui/views/inspector.tsx src/tui/views/humanVariables.tsx src/tui/modals/valueEditModal.tsx tests/tui/reveal.disk.test.tsx
git commit -m "feat(tui): honor global reveal at the masking render sites"
```

---

### Task 6: Header badge + footer/help wiring

**Files:**
- Modify: `src/tui/components/chrome.tsx` (Header badge + Footer prop)
- Modify: `src/tui/app.tsx` (pass `revealSecrets` to Footer)
- Modify: `src/tui/modals/host.tsx` (pass `revealSecrets` to HelpModal)
- Modify: `src/tui/modals/simpleModals.tsx` (HelpModal prop + use `contextHints`)
- Test: `tests/tui/reveal.disk.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/tui/reveal.disk.test.tsx`:

```tsx
describe("global reveal — chrome", () => {
  test("header badge appears while revealed", async () => {
    const rig = await renderApp();
    expect(rig.frame()).not.toContain("SECRETS SHOWN");
    await rig.type(CTRL_R);
    await tick(25);
    await rig.type("y");
    await tick(25);
    expect(rig.frame()).toContain("SECRETS SHOWN"); // @inkjs/ui Badge uppercases
    rig.ui.unmount();
  });

  test("the inspector footer drops the r peek hint while revealed", async () => {
    const rig = await renderApp();
    await rig.type("3"); // focus the inspector (wide layout)
    await tick(25);
    expect(rig.frame()).toContain("r reveal"); // peek hint present
    await rig.type(CTRL_R);
    await tick(25);
    await rig.type("y");
    await tick(25);
    expect(rig.frame()).not.toContain("r reveal"); // filtered out
    rig.ui.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tui/reveal.disk.test.tsx`
Expected: FAIL — no "SECRETS SHOWN" badge, and the footer still shows "r reveal" while revealed.

- [ ] **Step 3: Add the header badge**

In `src/tui/components/chrome.tsx`, in `Header`, add a badge after the consumer `<Text>` block, before the closing `</Box>` of the header:

```tsx
      <Text>
        consumer:{" "}
        <Text bold color={state.consumerFilter !== null ? theme.accent : undefined}>
          {state.consumerFilter ?? "all"}
        </Text>
      </Text>
      {state.revealSecrets ? <Badge color={theme.error}>secrets shown</Badge> : null}
    </Box>
```

- [ ] **Step 4: Thread `revealSecrets` into the Footer**

In `src/tui/components/chrome.tsx`, change the `Footer` signature and body:

```tsx
export function Footer({ context, revealSecrets }: { context: KeyContext; revealSecrets: boolean }): React.ReactElement {
  const hints = footerHints(context, revealSecrets);
```

In `src/tui/app.tsx`, update the Footer render (currently line 101) from:

```tsx
      <Footer context={keyContext(state, entry?.kind, modalOpen)} />
```

to:

```tsx
      <Footer context={keyContext(state, entry?.kind, modalOpen)} revealSecrets={state.revealSecrets} />
```

- [ ] **Step 5: Thread `revealSecrets` into the Help overlay**

In `src/tui/modals/simpleModals.tsx`, change the import on line 9 from:

```ts
import { HELP_SECTIONS, KEYMAP } from "../keys.ts";
```

to:

```ts
import { contextHints, HELP_SECTIONS } from "../keys.ts";
```

Change the `HelpModal` signature to accept the flag:

```tsx
export function HelpModal({
  revealSecrets,
  isTop,
  onClose,
}: {
  revealSecrets: boolean;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
```

In its body, change the hint loop source from `KEYMAP[section.context]` to:

```ts
    for (const hint of contextHints(section.context, revealSecrets)) {
```

In `src/tui/modals/host.tsx`, update the help case (currently line 29) from:

```tsx
      return <HelpModal isTop onClose={onClose} />;
```

to:

```tsx
      return <HelpModal revealSecrets={store.state.revealSecrets} isTop onClose={onClose} />;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/tui/reveal.disk.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/tui/components/chrome.tsx src/tui/app.tsx src/tui/modals/host.tsx src/tui/modals/simpleModals.tsx tests/tui/reveal.disk.test.tsx
git commit -m "feat(tui): reveal badge in the header, filter the r hint in footer + help"
```

---

### Task 7: README, lint, full suite

**Files:**
- Modify: `README.md` (TUI keys section)

- [ ] **Step 1: Document the global key**

In `README.md`, in the navigate bullet (currently lines 139–140), change:

```markdown
- Navigate: `tab`/`1`–`3` panes · `[` `]` tabs · `↑↓`/`jk` · `/` filter · `?`
  full key reference · `q` quit.
```

to:

```markdown
- Navigate: `tab`/`1`–`3` panes · `[` `]` tabs · `↑↓`/`jk` · `/` filter · `^r`
  reveal secrets · `?` full key reference · `q` quit.
```

- [ ] **Step 2: Update the secrets bullet**

In `README.md`, replace the secrets bullet (currently starting "- Secrets render `***` everywhere; reveal is per-value behind a confirm."):

```markdown
- Secrets render `***` everywhere. `^r` toggles a session-wide reveal of all
  secrets — the first reveal each session asks to confirm; hiding never does —
  and a red "secrets shown" badge marks the header while revealed. While
  revealed, the per-value `r` peek is unavailable; with secrets hidden, `r`
  reveals a single value behind its own confirm. A locked (encrypted) vault
  prompts for its passphrase in a masked modal — the passphrase stays in memory
  for the session, never on disk. `--vault-auth <vault>=<secret>` pre-unlocks.
```

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: no errors (no unused `KEYMAP` import remains in `simpleModals.tsx`).

- [ ] **Step 4: Run the whole suite**

Run: `bun test`
Expected: PASS — all suites green, including the new reveal tests and the existing peek test (`tests/tui/flows.disk.test.tsx` "reveal shows a secret only after an explicit confirm").

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document the ^r global reveal-secrets toggle"
```

---

## Self-Review

**Spec coverage:**
- `ctrl+r` global toggle → Task 4 (routing) + Task 3 (logic).
- Confirm once per session → Task 1 (`revealConfirmed` latch) + Task 3 (`toggleReveal` branches) + Task 4 test.
- Per-value `r` unavailable while revealed (behavior) → Task 4; (hints) → Task 2 + Task 6.
- Masking at inspector/DetailModal, human card, value-edit preview → Task 5 (DetailModal renders `inspectorBody(store.state)`, covered by the inspector change).
- Keymap entry + help/footer reflect state → Task 2 + Task 6.
- Header safety badge → Task 6.
- Out-of-scope items (timeout, persistence, non-secret masking, peek confirm flow) → untouched.
- README in the same change (CLAUDE.md rule) → Task 7.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output.

**Type/name consistency:** `revealSecrets`/`revealConfirmed` (state) and action `{ type: "revealSecrets"; revealed }` used identically across Tasks 1, 3, 5, 6. `toggleReveal(store)` signature matches its call in Task 4. `contextHints(context, revealSecrets)` / `footerHints(context, revealSecrets)` consistent across Tasks 2 and 6. Global confirm title "Reveal all secrets" (distinct from the peek's "Reveal secret") consistent in Task 3 and asserted in Task 4. `CTRL_R = "\u0012"` defined in Task 4, used in Tasks 4–6.
