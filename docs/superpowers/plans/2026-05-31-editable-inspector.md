# Editable Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the inspector into a focusable, navigable pane that lets you copy any field, edit a variable's description and example, and edit per-env values, group, secret, and wiring — all in one place.

**Architecture:** A pure `inspectorFields()` helper produces an ordered field list consumed by both the rewritten `Inspector` (rendering) and `app.tsx` (keyboard actions). Text edits flow through a generalized `EditFieldModal` driven by a small `editTarget` helper module that dispatches to existing store methods (`setValue`/`setDescription`/`setGroup`) plus a new `setExample`. Copy shells out via a cross-platform `clipboard` module injected into `MenvApp` for testability.

**Tech Stack:** Bun, React + Ink (TUI), `bun:test`, `ink-testing-library`. ESM with explicit `.ts`/`.tsx` import suffixes, named exports only, strict TypeScript.

---

## Design reference

Spec: `docs/superpowers/specs/2026-05-31-editable-inspector-design.md`.

Inspector field order (the navigation order): `description`, `example`, `group`,
`secret`, `wiring`, then one `value` row per environment.

| Field | `enter` | `c` (copy) |
|---|---|---|
| description / example / group | open `EditFieldModal` | copy text |
| value (per env) | open `EditFieldModal` for that env | copy that value |
| secret | `store.toggleSecret` in place | — (no-op) |
| wiring | open existing `WireModal` | — (no-op) |

## File structure

| File | Responsibility |
|---|---|
| `src/store/store.ts` | add `setExample` (Task 1) |
| `src/io/clipboard.ts` | **new** — `clipboardCommand` (pure) + `copyToClipboard` (Task 2) |
| `src/ui/inspectorFields.ts` | **new** — pure field-descriptor list + `copyableText` (Task 3) |
| `src/ui/editTarget.ts` | **new** — `EditTarget` type + `editLabel`/`editInitial`/`applyEdit` (Task 4) |
| `src/ui/components/EditFieldModal.tsx` | **new** — generalized text-edit modal (Task 5) |
| `src/ui/components/Inspector.tsx` | rewrite — focusable flat field list (Task 6) |
| `src/ui/app.tsx` | 3-pane tab cycle, inspector cursor, copy, edit dispatch, footer (Task 7) |
| `src/ui/components/EditValueModal.tsx` | **deleted** in Task 7 (replaced by `EditFieldModal`) |

Tests mirror these under `tests/`.

---

### Task 1: Store `setExample`

**Files:**
- Modify: `src/store/store.ts` (interface near line 13; impl near line 42)
- Test: `tests/store/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/store/store.test.ts`:

```ts
test("setExample sets and clears the example", () => {
  const store = createStore(baseModel());
  store.setExample("v1", "pg://example");
  expect(store.getModel().variables.find((v) => v.id === "v1")!.example).toBe("pg://example");
  store.setExample("v1", "");
  expect(store.getModel().variables.find((v) => v.id === "v1")!.example).toBeUndefined();
  expect(store.isDirty()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/store/store.test.ts`
Expected: FAIL — `store.setExample is not a function`.

- [ ] **Step 3: Add `setExample` to the `Store` interface**

In `src/store/store.ts`, add to the interface after the `setDescription` line:

```ts
  setDescription(varId: string, description: string): void;
  setExample(varId: string, example: string): void;
```

- [ ] **Step 4: Implement `setExample`**

In the returned object, after the `setDescription` implementation line, add:

```ts
    setExample(varId, example) { mapVar(varId, (v) => ({ ...v, example: example || undefined })); },
```

(An empty string clears `example` to `undefined`, matching how `persist.ts` normalizes
`""` ↔ `undefined`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/store/store.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add src/store/store.ts tests/store/store.test.ts
git commit -m "feat(store): add setExample"
```

---

### Task 2: Cross-platform clipboard module

**Files:**
- Create: `src/io/clipboard.ts`
- Test: `tests/io/clipboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/io/clipboard.test.ts`:

```ts
import { expect, test } from "bun:test";
import { clipboardCommand, copyToClipboard } from "../../src/io/clipboard.ts";

test("clipboardCommand maps each platform to its tool", () => {
  expect(clipboardCommand("darwin")).toEqual(["pbcopy"]);
  expect(clipboardCommand("win32")).toEqual(["clip"]);
  expect(clipboardCommand("linux")).toEqual(["xclip", "-selection", "clipboard"]);
});

test("clipboardCommand returns null for unsupported platforms", () => {
  expect(clipboardCommand("aix" as NodeJS.Platform)).toBeNull();
});

test("copyToClipboard reports failure when no clipboard tool exists", async () => {
  expect(await copyToClipboard("hi", "aix" as NodeJS.Platform)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/io/clipboard.test.ts`
Expected: FAIL — cannot find module `src/io/clipboard.ts`.

- [ ] **Step 3: Implement the module**

Create `src/io/clipboard.ts`:

```ts
// System-clipboard write, the one effect this feature performs. Mirrors the
// Bun.spawn idiom in src/crypto/identity.ts. `clipboardCommand` is split out as a
// pure function so the platform mapping is unit-testable without spawning.

export function clipboardCommand(platform: NodeJS.Platform): string[] | null {
  switch (platform) {
    case "darwin":
      return ["pbcopy"];
    case "win32":
      return ["clip"];
    case "linux":
      return ["xclip", "-selection", "clipboard"];
    default:
      return null;
  }
}

export async function copyToClipboard(
  text: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const cmd = clipboardCommand(platform);
  if (!cmd) return false;
  try {
    const p = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    p.stdin.write(text);
    await p.stdin.end();
    return (await p.exited) === 0;
  } catch {
    // Tool missing on PATH, spawn rejected, etc. — copy simply didn't happen.
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/io/clipboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/clipboard.ts tests/io/clipboard.test.ts
git commit -m "feat(io): cross-platform clipboard copy helper"
```

---

### Task 3: `inspectorFields` descriptor helper

**Files:**
- Create: `src/ui/inspectorFields.ts`
- Test: `tests/ui/inspectorFields.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ui/inspectorFields.test.ts`:

```ts
import { expect, test } from "bun:test";
import { inspectorFields, copyableText } from "../../src/ui/inspectorFields.ts";
import type { RepoModel, Variable } from "../../src/core/types.ts";

const variable: Variable = {
  id: "v1", name: "DATABASE_URL", tier: "global",
  description: "db conn", group: "DB", secret: true,
  consumers: ["app:api"], example: "pg://example",
};
const model: RepoModel = {
  root: "/r",
  environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
  variables: [variable],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: {} }],
  values: { v1: { dev: "pg://dev", prod: "pg://prod" } },
  recipients: [],
};

test("inspectorFields lists fixed fields then one value row per environment", () => {
  const fields = inspectorFields(model, variable);
  expect(fields.map((f) => f.kind)).toEqual([
    "description", "example", "group", "secret", "wiring", "value", "value",
  ]);
  const dev = fields.find((f) => f.kind === "value" && f.label === "dev");
  expect(dev).toMatchObject({ kind: "value", env: "dev", text: "pg://dev", secret: true });
});

test("wiring summary uses consumer display names", () => {
  const wiring = inspectorFields(model, variable).find((f) => f.kind === "wiring")!;
  expect(wiring).toMatchObject({ summary: "api" });
});

test("copyableText returns text for text fields and null for secret/wiring", () => {
  const fields = inspectorFields(model, variable);
  expect(copyableText(fields[0]!)).toBe("db conn"); // description
  expect(copyableText(fields.find((f) => f.kind === "secret")!)).toBeNull();
  expect(copyableText(fields.find((f) => f.kind === "wiring")!)).toBeNull();
  expect(copyableText(fields.find((f) => f.kind === "value" && f.label === "prod")!)).toBe("pg://prod");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ui/inspectorFields.test.ts`
Expected: FAIL — cannot find module `src/ui/inspectorFields.ts`.

- [ ] **Step 3: Implement the helper**

Create `src/ui/inspectorFields.ts`:

```ts
import type { RepoModel, Variable } from "../core/types.ts";

// One descriptor per navigable inspector row. The single source of truth shared by
// the Inspector (rendering) and app.tsx (keyboard actions) so the two never drift.
export type InspectorField =
  | { kind: "description" | "example" | "group"; label: string; text: string }
  | { kind: "secret"; label: string; on: boolean }
  | { kind: "wiring"; label: string; summary: string }
  | { kind: "value"; label: string; env: string; text: string; secret: boolean };

export function inspectorFields(model: RepoModel, variable: Variable): InspectorField[] {
  const consumerName = (id: string) => model.consumers.find((c) => c.id === id)?.name ?? id;
  const fields: InspectorField[] = [
    { kind: "description", label: "description", text: variable.description },
    { kind: "example", label: "example", text: variable.example ?? "" },
    { kind: "group", label: "group", text: variable.group ?? "" },
    { kind: "secret", label: "secret", on: variable.secret },
    { kind: "wiring", label: "wiring", summary: variable.consumers.map(consumerName).join(" · ") },
  ];
  for (const e of model.environments) {
    fields.push({
      kind: "value",
      label: e.id,
      env: e.id,
      text: model.values[variable.id]?.[e.id] ?? "",
      secret: variable.secret,
    });
  }
  return fields;
}

// The text `c` should copy, or null for fields that hold no copyable text.
export function copyableText(field: InspectorField): string | null {
  return field.kind === "secret" || field.kind === "wiring" ? null : field.text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ui/inspectorFields.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/inspectorFields.ts tests/ui/inspectorFields.test.ts
git commit -m "feat(ui): inspectorFields descriptor helper"
```

---

### Task 4: `editTarget` dispatch helper

**Files:**
- Create: `src/ui/editTarget.ts`
- Test: `tests/ui/editTarget.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ui/editTarget.test.ts`:

```ts
import { expect, test } from "bun:test";
import { editLabel, editInitial, applyEdit } from "../../src/ui/editTarget.ts";
import { createStore } from "../../src/store/store.ts";
import type { RepoModel } from "../../src/core/types.ts";

function model(): RepoModel {
  return {
    root: "/r", environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "PORT", tier: "global", description: "d", group: "G", secret: false, consumers: [], example: "ex" }],
    consumers: [], values: { v1: { dev: "3000" } }, recipients: [],
  };
}

test("editLabel describes the target", () => {
  expect(editLabel({ kind: "value", env: "dev" })).toBe("value · dev");
  expect(editLabel({ kind: "description" })).toBe("description");
  expect(editLabel({ kind: "example" })).toBe("example");
  expect(editLabel({ kind: "group" })).toBe("group");
});

test("editInitial reads the current field value", () => {
  const m = model();
  const v = m.variables[0]!;
  expect(editInitial(m, v, { kind: "value", env: "dev" })).toBe("3000");
  expect(editInitial(m, v, { kind: "description" })).toBe("d");
  expect(editInitial(m, v, { kind: "example" })).toBe("ex");
  expect(editInitial(m, v, { kind: "group" })).toBe("G");
});

test("applyEdit dispatches to the matching store method", () => {
  const store = createStore(model());
  applyEdit(store, "v1", { kind: "value", env: "dev" }, "4000");
  expect(store.getModel().values.v1!.dev).toBe("4000");
  applyEdit(store, "v1", { kind: "description" }, "new desc");
  expect(store.getModel().variables[0]!.description).toBe("new desc");
  applyEdit(store, "v1", { kind: "example" }, "newex");
  expect(store.getModel().variables[0]!.example).toBe("newex");
  applyEdit(store, "v1", { kind: "group" }, "  "); // blank → null
  expect(store.getModel().variables[0]!.group).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ui/editTarget.test.ts`
Expected: FAIL — cannot find module `src/ui/editTarget.ts`.

- [ ] **Step 3: Implement the helper**

Create `src/ui/editTarget.ts`:

```ts
import type { RepoModel, Variable } from "../core/types.ts";
import type { Store } from "../store/store.ts";

// Which text field an open EditFieldModal is editing. Toggles (secret) and wiring
// don't use the modal, so they aren't represented here.
export type EditTarget =
  | { kind: "value"; env: string }
  | { kind: "description" }
  | { kind: "example" }
  | { kind: "group" };

export function editLabel(t: EditTarget): string {
  return t.kind === "value" ? `value · ${t.env}` : t.kind;
}

export function editInitial(model: RepoModel, v: Variable, t: EditTarget): string {
  switch (t.kind) {
    case "value": return model.values[v.id]?.[t.env] ?? "";
    case "description": return v.description;
    case "example": return v.example ?? "";
    case "group": return v.group ?? "";
  }
}

export function applyEdit(store: Store, varId: string, t: EditTarget, value: string): void {
  switch (t.kind) {
    case "value": store.setValue(varId, t.env, value); return;
    case "description": store.setDescription(varId, value); return;
    case "example": store.setExample(varId, value); return;
    case "group": store.setGroup(varId, value.trim() || null); return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ui/editTarget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/editTarget.ts tests/ui/editTarget.test.ts
git commit -m "feat(ui): editTarget dispatch helper"
```

---

### Task 5: `EditFieldModal` (generalized text-edit modal)

`EditValueModal` only knows about "value". Add the more general `EditFieldModal` that
takes a `label`. (The old modal stays until Task 7 swaps `app.tsx` over to the new one.)

**Files:**
- Create: `src/ui/components/EditFieldModal.tsx`
- Test: `tests/ui/editField.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/ui/editField.test.tsx`:

```tsx
import { expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { EditFieldModal } from "../../src/ui/components/EditFieldModal.tsx";

test("renders the field label and submits the typed value", async () => {
  let submitted = "";
  const { lastFrame, stdin } = render(
    <EditFieldModal label="description" initial="" onSubmit={(v) => { submitted = v; }} onCancel={() => {}} />,
  );
  expect(lastFrame()).toContain("description");
  await new Promise((r) => setTimeout(r, 0));
  stdin.write("hello");
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 10));
  expect(submitted).toBe("hello");
});

test("esc cancels", async () => {
  let cancelled = false;
  const { stdin } = render(
    <EditFieldModal label="value · dev" initial="x" onSubmit={() => {}} onCancel={() => { cancelled = true; }} />,
  );
  await new Promise((r) => setTimeout(r, 0));
  stdin.write("\x1b");
  await new Promise((r) => setTimeout(r, 10));
  expect(cancelled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ui/editField.test.tsx`
Expected: FAIL — cannot find module `src/ui/components/EditFieldModal.tsx`.

- [ ] **Step 3: Implement the modal**

Create `src/ui/components/EditFieldModal.tsx` (same hand-rolled input idiom as the other
modals; renders exactly 5 rows — border + title + value + hint + border — so the
`bottomHeight = 5` layout budget in `app.tsx` is unchanged):

```tsx
import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

export function EditFieldModal({ label, initial, onSubmit, onCancel }: {
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const update = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSubmit(valueRef.current);
      return;
    }
    if (key.backspace || key.delete) {
      update(valueRef.current.slice(0, -1));
      return;
    }
    if (input) update(valueRef.current + input);
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text>Edit <Text bold>{label}</Text></Text>
      <Text>{value}</Text>
      <Text color="gray">enter save / esc cancel</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ui/editField.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/EditFieldModal.tsx tests/ui/editField.test.tsx
git commit -m "feat(ui): EditFieldModal generalizes the text-edit modal"
```

---

### Task 6: Rewrite `Inspector` as a focusable flat field list

**Files:**
- Modify (rewrite): `src/ui/components/Inspector.tsx`
- Test: `tests/ui/components.test.tsx` (update the existing Inspector test + add new ones)

- [ ] **Step 1: Update/replace the Inspector tests**

In `tests/ui/components.test.tsx`, **replace** the existing test:

```tsx
test("Inspector masks secret values", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} env="dev" />);
  expect(lastFrame()).toContain("DATABASE_URL");
  expect(lastFrame()).not.toContain("pg://x");
});
```

with:

```tsx
test("Inspector lists fields and masks a secret value", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("DATABASE_URL");
  expect(frame).toContain("description");
  expect(frame).toContain("secret");
  expect(frame).not.toContain("pg://x"); // value column masked
});

test("Inspector marks the selected field with a caret when focused", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} active cursor={0} height={14} />);
  expect(lastFrame()).toContain("▸");
});

test("Inspector shows no caret when unfocused", () => {
  const { lastFrame } = render(<Inspector model={model} variable={v} cursor={0} height={14} />);
  expect(lastFrame()).not.toContain("▸");
});

test("Inspector windows its field list to fit a short pane", () => {
  const manyEnvs: RepoModel = {
    ...model,
    environments: Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, isDefault: i === 0 })),
    values: { v1: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`e${i}`, `val${i}`])) },
  };
  const { lastFrame } = render(<Inspector model={manyEnvs} variable={{ ...v, secret: false }} active cursor={0} height={10} />);
  const frame = lastFrame() ?? "";
  expect(frame.split("\n").length).toBeLessThanOrEqual(10);
  expect(frame).toContain("more"); // overflow marker is present
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ui/components.test.tsx`
Expected: FAIL — the new props (`active`, `cursor`) and caret/`description` assertions
don't match the old read-only Inspector.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `src/ui/components/Inspector.tsx` with:

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { RepoModel, Variable } from "../../core/types.ts";
import { inspectorFields, type InspectorField } from "../inspectorFields.ts";
import { listWindow } from "./listWindow.ts";
import { MoreIndicator } from "./MoreIndicator.tsx";

const SECRET_MASK = "***";

// Truncates to `width` cells, marking the cut with a single-cell ellipsis.
function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return text.slice(0, width - 1) + "…";
}

function displayText(f: InspectorField): string {
  switch (f.kind) {
    case "secret": return f.on ? "yes" : "no";
    case "wiring": return f.summary || "-";
    case "group": return f.text || "-";
    case "value": return f.secret ? SECRET_MASK : (f.text || "- not set");
    default: return f.text; // description | example
  }
}

export function Inspector({ model, variable, active = false, cursor = 0, height }: {
  model: RepoModel;
  variable: Variable | null;
  active?: boolean;
  cursor?: number;
  height?: number;
}) {
  if (!variable) {
    return (
      <Box flexDirection="column" width={60} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="gray">select a variable</Text>
      </Box>
    );
  }
  const fields = inspectorFields(model, variable);
  const labelWidth = Math.max(...fields.map((f) => f.label.length));
  // Inner content width is 56 (box 60 − border 2 − paddingX 2). The value column gets
  // what's left after the 2-cell caret/indent, the label, and one gutter cell.
  const valueWidth = Math.max(0, 56 - 2 - labelWidth - 1);
  // Title(1) + 2 borders + 2 overflow-marker rows = 5 rows of chrome; the rest hold
  // fields. listWindow keeps the selected field visible and reclaims marker rows when
  // a side has nothing hidden (see listWindow's contract).
  const maxItems = height ? Math.max(0, height - 5) : fields.length;
  const windowed = listWindow(fields, cursor, maxItems);
  return (
    <Box flexDirection="column" width={60} height={height} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>{variable.name} <Text color="cyan">· {variable.tier}</Text></Text>
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((f, i) => {
        const idx = windowed.offset + i;
        const isCurrent = active && idx === cursor;
        const masked = f.kind === "value" && f.secret;
        return (
          <Text key={`${f.label}:${idx}`} backgroundColor={isCurrent ? "gray" : undefined}>
            {isCurrent ? "▸ " : "  "}
            <Text color="gray">{f.label.padEnd(labelWidth)}</Text>{" "}
            <Text color={masked ? "yellow" : undefined}>{truncate(displayText(f), valueWidth)}</Text>
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={fields.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/ui/components.test.tsx`
Expected: PASS (all tests in the file).

> Note: `app.tsx` still passes `env=` to `Inspector` at this point. Bun transpiles
> without type-checking, so the extra prop is ignored at runtime and the suite stays
> green; Task 7 removes it.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector.tsx tests/ui/components.test.tsx
git commit -m "feat(ui): focusable flat-list Inspector"
```

---

### Task 7: Wire the inspector into `app.tsx`

This connects everything: 3-pane tab cycle, inspector cursor, `c` copy, edit dispatch
via `EditFieldModal`, `secret`/`wiring` from the inspector, context-aware footer, and
removal of the old global `d`/`w` keys and `EditValueModal`.

**Files:**
- Modify (rewrite): `src/ui/app.tsx`
- Delete: `src/ui/components/EditValueModal.tsx`, `tests/ui/editValue.test.tsx`
- Test: `tests/ui/app.test.tsx` (add integration tests)

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/ui/app.test.tsx`:

```tsx
const editModel: RepoModel = {
  root: "/repo/acme",
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", tier: "global", description: "db", group: null, secret: false, consumers: ["app:api"], example: "ex" },
  ],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFiles: { dev: ".env" } }],
  values: { v1: { dev: "pg://x" } },
  recipients: [],
};

const tick = () => new Promise((r) => setTimeout(r, 20));

test("tab focuses the inspector and switches the footer to field hints", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  stdin.write("\t"); // vars -> inspector
  await tick();
  expect(lastFrame()).toContain("▸");   // selected-field caret
  expect(lastFrame()).toContain("esc"); // inspector footer hint
});

test("enter in the variable list edits the current environment value", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  stdin.write("\r"); // vars pane is default
  await tick();
  expect(lastFrame()).toContain("value · dev");
  stdin.write("Z");
  stdin.write("\r");
  await tick();
  expect(store.getModel().values.v1!.dev).toBe("pg://xZ");
});

test("editing the description in the inspector persists via the store", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  stdin.write("\t"); // inspector, cursor 0 = description
  await tick();
  stdin.write("\r"); // open modal
  await tick();
  expect(lastFrame()).toContain("description");
  stdin.write("X");
  stdin.write("\r");
  await tick();
  expect(store.getModel().variables[0]!.description).toBe("dbX");
});

test("c copies the selected inspector field via the injected copy fn", async () => {
  const store = createStore(editModel);
  let copied = "";
  const { lastFrame, stdin } = render(
    <MenvApp store={store} onSaveStamp={() => "s"} copy={async (t) => { copied = t; return true; }} viewportRows={20} viewportColumns={100} />,
  );
  stdin.write("\t"); // inspector, cursor 0 = description ("db")
  await tick();
  stdin.write("c");
  await tick();
  expect(copied).toBe("db");
  expect(lastFrame()).toContain("copied DATABASE_URL");
});

test("c reports when the clipboard tool is unavailable", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(
    <MenvApp store={store} onSaveStamp={() => "s"} copy={async () => false} viewportRows={20} viewportColumns={100} />,
  );
  stdin.write("c"); // vars pane: copy current env value
  await tick();
  expect(lastFrame()).toContain("clipboard unavailable");
});

test("enter on the secret field toggles secret", async () => {
  const store = createStore(editModel);
  const { stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  stdin.write("\t"); // inspector cursor 0
  await tick();
  stdin.write("\x1b[B"); stdin.write("\x1b[B"); stdin.write("\x1b[B"); // -> 3 secret
  await tick();
  stdin.write("\r");
  await tick();
  expect(store.getModel().variables[0]!.secret).toBe(true);
});

test("enter on the wiring field opens the wire modal", async () => {
  const store = createStore(editModel);
  const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  stdin.write("\t");
  await tick();
  for (let i = 0; i < 4; i++) stdin.write("\x1b[B"); // -> 4 wiring
  await tick();
  stdin.write("\r");
  await tick();
  expect(lastFrame()).toContain("Wire");
});

test("enter on a value row edits that environment's value", async () => {
  const store = createStore(editModel);
  const { stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={20} viewportColumns={100} />);
  stdin.write("\t");
  await tick();
  for (let i = 0; i < 5; i++) stdin.write("\x1b[B"); // -> 5 value:dev
  await tick();
  stdin.write("\r");
  await tick();
  stdin.write("Y");
  stdin.write("\r");
  await tick();
  expect(store.getModel().values.v1!.dev).toBe("pg://xY");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/ui/app.test.tsx`
Expected: FAIL — the inspector isn't focusable, `c` does nothing, etc.

- [ ] **Step 3: Rewrite `app.tsx`**

Replace the entire contents of `src/ui/app.tsx` with:

```tsx
import React, { useState } from "react";
import { Box, Text, useApp, useInput, useStdout, render } from "ink";
import type { Store } from "../store/store.ts";
import { useModel, useDirty } from "./useStore.ts";
import { useTerminalSize } from "./useTerminalSize.ts";
import { TopBar } from "./components/TopBar.tsx";
import { ScopeTree } from "./components/ScopeTree.tsx";
import { buildScopes, varsForScope, stepScope } from "./scopes.ts";
import { VariableList } from "./components/VariableList.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { EditFieldModal } from "./components/EditFieldModal.tsx";
import { NewVariableModal } from "./components/NewVariableModal.tsx";
import { WireModal } from "./components/WireModal.tsx";
import { inspectorFields, copyableText } from "./inspectorFields.ts";
import { type EditTarget, editLabel, editInitial, applyEdit } from "./editTarget.ts";
import { copyToClipboard } from "../io/clipboard.ts";
import { valueOf } from "../core/model.ts";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { loadRepo } from "../store/load.ts";
import { loadOrCreateIdentity } from "../crypto/identity.ts";

type Pane = "scopes" | "vars" | "inspector";
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

const SEPARATOR = " · ";

// A single keycap chip, e.g. ` tab `, matching the prior inline styling.
const Key = ({ children }: { children: React.ReactNode }) => (
  <Text bold backgroundColor="blackBright"> {children} </Text>
);

export function MenvApp({ store, onSaveStamp, copy = copyToClipboard, viewportRows, viewportColumns }: {
  store: Store;
  onSaveStamp: () => string;
  copy?: (text: string) => Promise<boolean>;
  viewportRows?: number;
  viewportColumns?: number;
}) {
  const model = useModel(store);
  const dirty = useDirty(store);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const term = useTerminalSize(stdout);
  const rows = viewportRows ?? term.rows ?? 24;
  const columns = viewportColumns ?? term.columns ?? 100;

  const scopes = buildScopes(model);
  const [pane, setPane] = useState<Pane>("vars");
  const [scopeCursor, setScopeCursor] = useState(0);
  const [varCursor, setVarCursor] = useState(0);
  const [inspectorCursor, setInspectorCursor] = useState(0);
  const [env, setEnv] = useState(model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev");
  const [mode, setMode] = useState<Mode>("browse");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");

  // The layout is exact: topBar(3) + paneHeight + bottomHeight = rows, so bottomHeight
  // must equal the bottom region's *actual* rendered height. (Wire mode is the
  // exception: it hides the panes and covers the full area below the top bar.)
  const bottomHeight =
    mode === "browse" ? 1 // status line
    : mode === "filter" ? 3 // border(2) + input(1)
    : mode === "edit" || mode === "new" ? 5 // border(2) + title + field + hint
    : 1;
  const paneHeight = Math.max(3, rows - 3 - bottomHeight);

  const scope = scopes[scopeCursor];
  const variables = scope ? varsForScope(model, scope.id) : model.variables;
  const filtered = filter
    ? variables.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase()))
    : variables;
  const current = filtered[varCursor] ?? null;
  const fields = current ? inspectorFields(model, current) : [];
  // Clamp so the rendered/acted-on field stays in range as the variable changes.
  const inspCursor = Math.min(inspectorCursor, Math.max(0, fields.length - 1));

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
      setPane((p) => (p === "scopes" ? "vars" : p === "vars" ? (current ? "inspector" : "scopes") : "scopes"));
      return;
    }
    if (key.escape && pane === "inspector") {
      setPane("vars");
      return;
    }
    if (key.upArrow) {
      if (pane === "scopes") {
        const next = stepScope(scopes, scopeCursor, -1);
        setScopeCursor(next);
        if (next !== scopeCursor) { setVarCursor(0); setInspectorCursor(0); }
      } else if (pane === "vars") {
        setVarCursor((c) => Math.max(0, c - 1));
        setInspectorCursor(0);
      } else {
        setInspectorCursor((c) => Math.max(0, c - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (pane === "scopes") {
        const next = stepScope(scopes, scopeCursor, 1);
        setScopeCursor(next);
        if (next !== scopeCursor) { setVarCursor(0); setInspectorCursor(0); }
      } else if (pane === "vars") {
        setVarCursor((c) => Math.min(filtered.length - 1, c + 1));
        setInspectorCursor(0);
      } else {
        setInspectorCursor((c) => Math.min(fields.length - 1, c + 1));
      }
      return;
    }
    if (input === "e") {
      const ids = model.environments.map((e) => e.id);
      setEnv((cur) => ids[(ids.indexOf(cur) + 1) % ids.length]);
      return;
    }
    if (input === "c" && current) {
      const field = pane === "inspector" ? fields[inspCursor] : undefined;
      const text = field ? copyableText(field) : valueOf(model, current.id, env);
      const label = field ? (field.kind === "value" ? `(${field.env})` : field.label) : `(${env})`;
      if (text === null) {
        setStatus("nothing to copy");
        return;
      }
      const name = current.name;
      void copy(text).then((ok) => setStatus(ok ? `copied ${name} ${label}` : "clipboard unavailable"));
      return;
    }
    if (key.return && current) {
      if (pane === "inspector") {
        const f = fields[inspCursor];
        if (!f) return;
        if (f.kind === "secret") { store.toggleSecret(current.id); return; }
        if (f.kind === "wiring") { setMode("wire"); return; }
        setEditTarget(f.kind === "value" ? { kind: "value", env: f.env } : { kind: f.kind });
        setMode("edit");
        return;
      }
      if (pane === "vars") {
        setEditTarget({ kind: "value", env });
        setMode("edit");
        return;
      }
    }
    if (input === "/") {
      setMode("filter");
      return;
    }
    if (input === "n") {
      setMode("new");
      return;
    }
    if (input === "x" && current) {
      store.deleteVariable(current.id);
      setVarCursor((c) => Math.max(0, Math.min(c, filtered.length - 2)));
      setInspectorCursor(0);
      if (pane === "inspector") setPane("vars");
      return;
    }
    if (input === "s") {
      void saveModel(store.getModel(), onSaveStamp()).then((sum) => {
        store.markClean();
        setStatus(`saved ${sum.files.length} files`);
      });
    }
  });

  if (mode === "wire" && current) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <TopBar root={model.root} env={env} dirty={dirty} unsaved={dirty ? 1 : 0} />
        <WireModal
          varName={current.name}
          consumers={model.consumers}
          wired={current.consumers}
          onToggle={(id) => store.wire(current.id, id, !current.consumers.includes(id))}
          onClose={() => setMode("browse")}
          height={Math.max(3, rows - 3)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <TopBar root={model.root} env={env} dirty={dirty} unsaved={dirty ? 1 : 0} />
      <Box height={paneHeight}>
        <ScopeTree scopes={scopes} cursor={scopeCursor} active={pane === "scopes"} height={paneHeight} />
        <VariableList variables={filtered} cursor={varCursor} active={pane === "vars"} height={paneHeight} scopeLabel={scope?.label} consumers={model.consumers} showScopes={scope?.kind === "all"} filter={filter} model={model} env={env} />
        <Inspector model={model} variable={current} active={pane === "inspector"} cursor={inspCursor} height={paneHeight} />
      </Box>
      {mode === "edit" && current && editTarget ? (
        <EditFieldModal
          label={editLabel(editTarget)}
          initial={editInitial(model, current, editTarget)}
          onSubmit={(v) => { applyEdit(store, current.id, editTarget, v); setMode("browse"); setEditTarget(null); }}
          onCancel={() => { setMode("browse"); setEditTarget(null); }}
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
      ) : (
        <Box paddingX={1} justifyContent="space-between">
          {pane === "inspector" ? (
            <Text color="gray">
              <Key>↑↓</Key> field{SEPARATOR}<Key>⏎</Key> edit{SEPARATOR}<Key>c</Key> copy{SEPARATOR}<Key>esc</Key> back{SEPARATOR}<Key>tab</Key> pane{SEPARATOR}<Key>e</Key> env{SEPARATOR}<Key>s</Key> save{SEPARATOR}<Key>q</Key> quit
            </Text>
          ) : (
            <Text color="gray">
              <Key>↑↓</Key> move{SEPARATOR}<Key>tab</Key> pane{SEPARATOR}<Key>⏎</Key> edit{SEPARATOR}<Key>c</Key> copy{SEPARATOR}<Key>/</Key> filter{SEPARATOR}<Key>n</Key> new{SEPARATOR}<Key>x</Key> delete{SEPARATOR}<Key>e</Key> env{SEPARATOR}<Key>s</Key> save{SEPARATOR}<Key>q</Key> quit
            </Text>
          )}
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

- [ ] **Step 4: Delete the superseded modal and its test**

```bash
git rm src/ui/components/EditValueModal.tsx tests/ui/editValue.test.tsx
```

- [ ] **Step 5: Run the affected tests to verify they pass**

Run: `bun test tests/ui/app.test.tsx`
Expected: PASS (all tests, old and new).

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.tsx tests/ui/app.test.tsx
git commit -m "feat(ui): editable inspector — copy, edit description/example, in-pane secret & wiring"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: PASS — every test green, no leftover references to `EditValueModal`.

- [ ] **Step 2: Type-check via the build (catches any stray type mismatch)**

Run: `bun run build`
Expected: a `./menv` binary is produced with no type errors. (Then remove it:
`rm -f ./menv`.)

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Run: `bun run menv` in a menv-initialized repo, then:
- `tab` twice to focus the inspector; `↑↓` moves the caret; the footer reads field hints.
- `enter` on `description`/`example` edits text; `enter` on `secret` toggles; `enter` on
  `wiring` opens the wire modal; `enter` on a value row edits that env's value.
- `c` on a field copies it (paste elsewhere to confirm); status shows `copied …`.
- `s` saves; confirm `.menv/manifest.toml` reflects the new description/example and the
  app's `.env.example` reflects the new example value.

- [ ] **Step 4: Commit (only if Step 3 surfaced fixes)**

```bash
git add -A
git commit -m "fix: address editable-inspector smoke-test findings"
```

---

## Self-review notes

- **Spec coverage:** copy value (Tasks 2, 7 `c`), change description (Tasks 4–7),
  change example (Tasks 1, 4–7 via `setExample`), inspector redesign (Tasks 3, 6),
  comprehensive hub incl. secret/group/wiring (Tasks 3, 7), cross-platform clipboard
  (Task 2), context-aware footer + removal of global `d`/`w` (Task 7). `tier` is
  intentionally display-only (spec scope cut) — no task edits it.
- **Type consistency:** `EditTarget` kinds (`value`/`description`/`example`/`group`)
  match across `editTarget.ts`, the `applyEdit` switch, and `app.tsx`'s `enter` handler.
  `InspectorField` kinds match across `inspectorFields.ts`, `Inspector.tsx`'s
  `displayText`, and `app.tsx`'s `c`/`enter` handlers. `copy` prop signature
  `(text: string) => Promise<boolean>` matches `copyToClipboard`.
- **No placeholders:** every code step contains complete, runnable code.
```
