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

// ── vault badges ─────────────────────────────────────────────────────────────

export interface VaultBadge {
  encrypted: boolean | undefined; // undefined for non-local vault types
  unlocked: boolean;
  isDefault: boolean;
  isActive: boolean;
}

// "E+" encrypted+open, "E-" encrypted+locked, "P" plaintext (always open).
export function vaultBadgeText(b: VaultBadge): string {
  const enc = b.encrypted === false ? "P" : "E";
  const lock = enc === "P" ? "" : b.unlocked ? "+" : "-";
  return `${enc}${lock}${b.isDefault ? " *" : ""}`;
}

export function isEncryptedConfig(vaultType: string, vaultConfig: unknown): boolean | undefined {
  if (vaultType !== "menv-local") return undefined;
  const enc = (vaultConfig as { encryption?: unknown }).encryption;
  return enc !== false;
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
