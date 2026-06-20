// One source of truth for what each navigable list contains, shared by the
// views (rendering) and the input layer (selection movement / actions) so the
// two can never disagree about what's selected.
import type { Registry } from "../../registry/types.ts";
import type { VariableRow } from "./selectors.ts";
import { matches, variableRows } from "./selectors.ts";
import type { AppState } from "./store.tsx";

// ── sidebar ──────────────────────────────────────────────────────────────────

export type SidebarEntry =
  | { kind: "header"; title: string }
  | { kind: "vault"; name: string }
  | { kind: "consumer"; name: string }
  | { kind: "empty"; hint: string };

export function sidebarEntries(registry: Registry): SidebarEntry[] {
  const vaults = Object.keys(registry.vaults).sort();
  const consumers = Object.keys(registry.consumers).sort();
  return [
    { kind: "header", title: "VAULTS" },
    ...vaults.map((name): SidebarEntry => ({ kind: "vault", name })),
    { kind: "header", title: "CONSUMERS" },
    ...(consumers.length === 0
      ? [{ kind: "empty", hint: "none — press a" } as SidebarEntry]
      : consumers.map((name): SidebarEntry => ({ kind: "consumer", name }))),
  ];
}

export function isSelectable(entry: SidebarEntry | VariableRow): boolean {
  if ("kind" in entry) return entry.kind === "vault" || entry.kind === "consumer";
  return entry.type === "var";
}

// Move over a list skipping non-selectable rows; clamps at the edges.
export function moveSelectable<T>(items: T[], current: number, delta: number, selectable: (item: T) => boolean): number {
  if (items.length === 0) return 0;
  const dir = delta < 0 ? -1 : 1;
  let remaining = Math.abs(delta);
  let index = Math.min(items.length - 1, Math.max(0, current));
  while (remaining > 0) {
    let next = index + dir;
    while (next >= 0 && next < items.length && !selectable(items[next] as T)) next += dir;
    if (next < 0 || next >= items.length) break;
    index = next;
    remaining -= 1;
  }
  // If we started on a non-selectable row, settle on the nearest selectable one.
  if (!selectable(items[index] as T)) {
    let next = index + dir;
    while (next >= 0 && next < items.length && !selectable(items[next] as T)) next += dir;
    if (next >= 0 && next < items.length) index = next;
    else {
      let prev = index - dir;
      while (prev >= 0 && prev < items.length && !selectable(items[prev] as T)) prev -= dir;
      if (prev >= 0 && prev < items.length) index = prev;
    }
  }
  return index;
}

export function firstSelectable<T>(items: T[], selectable: (item: T) => boolean): number {
  const i = items.findIndex((it) => selectable(it));
  return i === -1 ? 0 : i;
}

// The stored index can land on a header row (initial state, list reshapes
// after filter/mutation) — settle it onto the nearest selectable row so the
// cursor and the action keys always agree.
export function settleIndex<T>(items: T[], index: number, selectable: (item: T) => boolean): number {
  if (items.length === 0) return 0;
  const at = Math.min(items.length - 1, Math.max(0, index));
  const item = items[at];
  if (item !== undefined && selectable(item)) return at;
  for (let next = at + 1; next < items.length; next++) {
    const candidate = items[next];
    if (candidate !== undefined && selectable(candidate)) return next;
  }
  for (let prev = at - 1; prev >= 0; prev--) {
    const candidate = items[prev];
    if (candidate !== undefined && selectable(candidate)) return prev;
  }
  return at;
}

// ── main-pane lists per tab ──────────────────────────────────────────────────

export function variablesList(state: AppState): VariableRow[] {
  return variableRows(state.registry, {
    vault: state.activeVault,
    consumer: state.consumerFilter ?? undefined,
    filter: state.filters.variables,
  });
}

export function globalsList(state: AppState): string[] {
  return Object.keys(state.registry.globals)
    .filter((n) => matches(state.filters.globals, n))
    .sort();
}

export function groupsList(state: AppState): string[] {
  return Object.keys(state.registry.groups)
    .filter((k) => matches(state.filters.groups, k))
    .sort();
}

export function composeList(state: AppState): string[] {
  return state.registry.compose.files.filter((f) => matches(state.filters.compose, f));
}

export function backupsList(state: AppState): string[] {
  // Newest first — keys are timestamps.
  return [...state.backups].filter((b) => matches(state.filters.backups, b)).sort().reverse();
}

export function mainListLength(state: AppState): number {
  switch (state.tab) {
    case "variables":
      return variablesList(state).length;
    case "globals":
      return globalsList(state).length;
    case "groups":
      return groupsList(state).length;
    case "compose":
      return composeList(state).length;
    case "backups":
      return backupsList(state).length;
  }
}

export function selectedSidebarEntry(state: AppState): SidebarEntry | undefined {
  return sidebarEntries(state.registry)[state.sidebarIndex];
}

export function selectedVariable(state: AppState): string | undefined {
  const rows = variablesList(state);
  const row = rows[settleIndex(rows, state.mainIndex.variables, isSelectable)];
  return row?.type === "var" ? row.name : undefined;
}

export function selectedMainId(state: AppState): string | undefined {
  switch (state.tab) {
    case "variables":
      return selectedVariable(state);
    case "globals":
      return globalsList(state)[state.mainIndex.globals];
    case "groups":
      return groupsList(state)[state.mainIndex.groups];
    case "compose":
      return composeList(state)[state.mainIndex.compose];
    case "backups":
      return backupsList(state)[state.mainIndex.backups];
  }
}
