// Pure derivations over the registry + value snapshots. No I/O, no React —
// unit-tested directly in tests/tui/selectors.test.ts.
import type { Registry, VariableDef } from "../../registry/types.ts";
import type { ThemeColor } from "../theme.ts";
import { theme } from "../theme.ts";

// ── wiring cell state ────────────────────────────────────────────────────────

export interface CellState {
  wired: boolean;
  key?: string;
  disabled: boolean;
  shared: boolean; // 2+ consumers point at the same key in this vault
  // true/false when the vault's values are known; undefined when locked
  hasValue?: boolean;
}

export function cellState(
  def: VariableDef,
  vault: string,
  consumer: string,
  values: Record<string, string> | null,
): CellState {
  const mapping = def.vaultMapping[vault] ?? {};
  const entry = mapping[consumer];
  if (entry === undefined) return { wired: false, disabled: false, shared: false };
  const shared = Object.entries(mapping).some(([c, e]) => c !== consumer && e.key === entry.key);
  return {
    wired: true,
    key: entry.key,
    disabled: entry.disabled === true,
    shared,
    hasValue: values === null ? undefined : values[entry.key] !== undefined,
  };
}

// Color is never the only signal: each state has its own glyph (legend in `?`).
export function cellGlyph(cell: CellState): { char: string; color: ThemeColor } {
  if (!cell.wired) return { char: "·", color: theme.muted };
  if (cell.disabled) return { char: "#", color: theme.muted };
  const char = cell.shared ? "◆" : "●";
  if (cell.hasValue === undefined) return { char, color: theme.muted }; // locked vault
  if (!cell.hasValue) return { char: "◌", color: theme.error };
  return { char, color: theme.success };
}

// ── variable list rows (grouped + filtered) ─────────────────────────────────

export type VariableRow =
  | { type: "header"; title: string }
  | { type: "var"; name: string; def: VariableDef };

// Smart-case substring match: all-lowercase queries are case-insensitive.
export function matches(query: string, candidate: string): boolean {
  if (query === "") return true;
  if (query === query.toLowerCase()) return candidate.toLowerCase().includes(query);
  return candidate.includes(query);
}

export interface VariableScope {
  vault: string;
  consumer?: string; // narrow to variables wired for this consumer (any vault filter applies on vault)
  filter: string;
}

export function variableRows(registry: Registry, scope: VariableScope): VariableRow[] {
  const names = Object.keys(registry.variables)
    .filter((name) => matches(scope.filter, name))
    .filter((name) => {
      if (scope.consumer === undefined) return true;
      const def = registry.variables[name];
      if (def === undefined) return false;
      return Object.values(def.vaultMapping).some((byConsumer) => byConsumer[scope.consumer ?? ""] !== undefined);
    })
    .sort();
  const byGroup = new Map<string | undefined, string[]>();
  for (const name of names) {
    const g = registry.variables[name]?.groupKey;
    byGroup.set(g, [...(byGroup.get(g) ?? []), name]);
  }
  const rows: VariableRow[] = [];
  const groupKeys = Object.keys(registry.groups).sort((a, b) =>
    (registry.groups[a]?.title ?? a).localeCompare(registry.groups[b]?.title ?? b),
  );
  const emit = (key: string | undefined, title: string): void => {
    const members = byGroup.get(key);
    if (members === undefined) return;
    rows.push({ type: "header", title });
    for (const name of members) {
      const def = registry.variables[name];
      if (def !== undefined) rows.push({ type: "var", name, def });
    }
  };
  for (const key of groupKeys) emit(key, registry.groups[key]?.title ?? key);
  // groupKeys pointing at a removed group render under their raw key
  for (const key of [...byGroup.keys()].filter((k) => k !== undefined && !(k in registry.groups)).sort()) {
    emit(key, key as string);
  }
  emit(undefined, "(ungrouped)");
  return rows;
}

export function variableCount(rows: VariableRow[]): number {
  return rows.filter((r) => r.type === "var").length;
}

// ── wiring matrix rows for the inspector ────────────────────────────────────

export interface WiringRow {
  vault: string;
  consumer: string;
  cell: CellState;
}

export function wiringRows(
  def: VariableDef,
  valuesByVault: Record<string, Record<string, string> | null>,
): WiringRow[] {
  const rows: WiringRow[] = [];
  for (const vault of Object.keys(def.vaultMapping).sort()) {
    for (const consumer of Object.keys(def.vaultMapping[vault] ?? {}).sort()) {
      rows.push({ vault, consumer, cell: cellState(def, vault, consumer, valuesByVault[vault] ?? null) });
    }
  }
  return rows;
}

// ── human-mode variable rows ─────────────────────────────────────────────────

export interface HumanVarRow {
  consumer: string;
  key: string;
  value: string | undefined; // raw value (undefined when locked or missing)
  disabled: boolean;
  hasValue: boolean | undefined; // undefined when the vault is locked
}

// One row per consumer wired to `def` in `vault`, grouped so the most-shared
// values rise to the top: groups ordered by descending consumer count (ties
// broken by value string ascending, the no-value group last), consumers within
// a group alphabetical. A locked vault (values === null) has no value knowledge,
// so every row lands in one bucket and the order is plain alphabetical.
export function humanVarRows(
  def: VariableDef,
  vault: string,
  values: Record<string, string> | null,
): HumanVarRow[] {
  const mapping = def.vaultMapping[vault] ?? {};
  const rows: HumanVarRow[] = Object.entries(mapping).map(([consumer, entry]) => ({
    consumer,
    key: entry.key,
    value: values === null ? undefined : values[entry.key],
    disabled: entry.disabled === true,
    hasValue: values === null ? undefined : values[entry.key] !== undefined,
  }));
  const byValue = new Map<string | undefined, HumanVarRow[]>();
  for (const row of rows) {
    const bucket = byValue.get(row.value) ?? [];
    bucket.push(row);
    byValue.set(row.value, bucket);
  }
  const groups = [...byValue.entries()].sort((a, b) => {
    if (a[0] === undefined) return 1; // no-value group always last
    if (b[0] === undefined) return -1;
    if (b[1].length !== a[1].length) return b[1].length - a[1].length; // count desc
    return a[0].localeCompare(b[0]); // tie: value string asc
  });
  return groups.flatMap(([, members]) => members.sort((x, y) => x.consumer.localeCompare(y.consumer)));
}

// A scrolling window onto `text` of `width` columns at a given step. step 0 is
// the head; each step advances one column until the tail is fully revealed,
// then clamps (it never loops back to the start).
export function marqueeSlice(text: string, width: number, step: number): string {
  const max = Math.max(0, text.length - width);
  const start = Math.min(Math.max(0, step), max);
  return text.slice(start, start + width);
}

export interface CardWindow {
  offset: number;
  count: number;
  above: number;
  below: number;
}

// Variable-height analogue of ScrollList's windowing: pick a contiguous run of
// whole cards that fits `available` lines and contains `selected`, growing
// outward (below first, then above) so the cursor drifts toward the top. A
// single card taller than the budget is still shown (clipped).
export function cardWindow(heights: number[], selected: number, available: number): CardWindow {
  const n = heights.length;
  if (n === 0) return { offset: 0, count: 0, above: 0, below: 0 };
  const total = heights.reduce((a, b) => a + b, 0);
  if (total <= available) return { offset: 0, count: n, above: 0, below: 0 };
  const sel = Math.min(Math.max(0, selected), n - 1);
  let lo = sel;
  let hi = sel;
  let used = heights[sel] ?? 0;
  for (let grew = true; grew; ) {
    grew = false;
    if (hi + 1 < n && used + (heights[hi + 1] ?? 0) <= available) {
      hi += 1;
      used += heights[hi] ?? 0;
      grew = true;
    }
    if (lo - 1 >= 0 && used + (heights[lo - 1] ?? 0) <= available) {
      lo -= 1;
      used += heights[lo] ?? 0;
      grew = true;
    }
  }
  const count = hi - lo + 1;
  return { offset: lo, count, above: lo, below: n - (lo + count) };
}

// ── vault badges ─────────────────────────────────────────────────────────────

export interface VaultBadge {
  unlocked: boolean;
  isDefault: boolean;
}

// Lock state only — encryption is an implementation detail of how a vault
// enforces auth, not something we surface. Locked vaults are marked "⚿"; an
// unlocked vault carries no lock glyph. "*" flags the default vault.
export const LOCK_GLYPH = "⚿";
export function vaultBadgeText(b: VaultBadge): string {
  const lock = b.unlocked ? "" : LOCK_GLYPH;
  if (b.isDefault) return lock === "" ? "*" : `${lock} *`;
  return lock;
}

// ── misc ─────────────────────────────────────────────────────────────────────

export function truncate(s: string, width: number): string {
  if (width <= 0) return "";
  if (s.length <= width) return s;
  if (width === 1) return "…";
  return `${s.slice(0, width - 1)}…`;
}

export function maskValue(secret: boolean, value: string | undefined): string {
  if (value === undefined) return "∅";
  return secret ? "***" : value;
}
