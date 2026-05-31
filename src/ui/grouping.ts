import type { Variable } from "../core/types.ts";

// The variable list can be presented either flat (sorted by name) or grouped by
// the variables' `group` tag. Grouped layout puts the ungrouped variables first
// under a muted virtual "Ungrouped" header, then each real group alphabetically;
// variables within a bucket are sorted by name. These pure helpers produce the
// display order, the rendered rows, and the bucket boundaries used for navigation.

export const UNGROUPED_LABEL = "Ungrouped";

export type VarRow =
  | { kind: "header"; group: string | null; label: string; muted: boolean }
  | { kind: "var"; variable: Variable; index: number };

const byName = (a: Variable, b: Variable) => a.name.localeCompare(b.name);

// Distinct non-null group names present in the list, sorted.
export function groupNames(variables: Variable[]): string[] {
  const set = new Set<string>();
  for (const v of variables) if (v.group !== null) set.add(v.group);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// The rows to render. `index` numbers the variable rows in display order so the
// caller's cursor (a variable index) maps straight onto them.
export function groupedRows(variables: Variable[], grouped: boolean): VarRow[] {
  const rows: VarRow[] = [];
  let i = 0;
  const pushVars = (vs: Variable[]) => {
    for (const v of [...vs].sort(byName)) rows.push({ kind: "var", variable: v, index: i++ });
  };

  if (!grouped) {
    pushVars(variables);
    return rows;
  }

  const ungrouped = variables.filter((v) => v.group === null);
  if (ungrouped.length) {
    rows.push({ kind: "header", group: null, label: UNGROUPED_LABEL, muted: true });
    pushVars(ungrouped);
  }
  for (const g of groupNames(variables)) {
    const members = variables.filter((v) => v.group === g);
    if (!members.length) continue;
    rows.push({ kind: "header", group: g, label: g, muted: false });
    pushVars(members);
  }
  return rows;
}

// Variables in display order (the var rows of groupedRows).
export function orderedVariables(variables: Variable[], grouped: boolean): Variable[] {
  return groupedRows(variables, grouped).flatMap((r) => (r.kind === "var" ? [r.variable] : []));
}

// The variable index at which each bucket begins. Flat layout is one bucket at 0.
export function groupStarts(variables: Variable[], grouped: boolean): number[] {
  const rows = groupedRows(variables, grouped);
  const starts: number[] = [];
  let afterHeader = false;
  for (const r of rows) {
    if (r.kind === "header") {
      afterHeader = true;
    } else {
      if (afterHeader) starts.push(r.index);
      afterHeader = false;
    }
  }
  if (!starts.length && rows.some((r) => r.kind === "var")) starts.push(0);
  return starts;
}

// Move the cursor to a neighbouring bucket. `next` goes to the following bucket's
// first variable; `prev` snaps to the current bucket's start first, then to the
// previous bucket. Clamps at the ends.
export function jumpGroup(starts: number[], cursor: number, dir: 1 | -1): number {
  if (!starts.length) return cursor;
  const curStart = [...starts].reverse().find((s) => s <= cursor) ?? starts[0]!;
  if (dir === 1) {
    return starts.find((s) => s > curStart) ?? cursor;
  }
  if (cursor > curStart) return curStart;
  const idx = starts.indexOf(curStart);
  return idx > 0 ? starts[idx - 1]! : curStart;
}
