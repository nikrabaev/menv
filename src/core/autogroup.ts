import type { Variable } from "./types.ts";

// A name's underscore-delimited segments, or null when it has no usable prefix:
// a single-segment name (no underscore) can't imply a group, and a leading
// underscore would give an empty first segment.
function segmentsOf(name: string): string[] | null {
  const segs = name.split("_");
  if (segs.length < 2 || segs[0] === "") return null;
  return segs;
}

// The longest run of leading whole segments common to every list (compared
// segment-by-segment, so two names never share a partial segment).
function commonSegmentPrefix(lists: string[][]): string[] {
  const first = lists[0];
  if (!first) return [];
  const out: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i]!;
    if (lists.every((l) => l[i] === seg)) out.push(seg);
    else break;
  }
  return out;
}

// Assign variables to groups by their shared name prefix. Variables are clustered
// by their leading segment (the text before the first underscore), and a cluster
// becomes a group only when 2+ distinct variable names share that segment. The
// group's name is the *longest segment-prefix every member shares* — so DB_USER,
// DB_HOST → "DB", but NEXT_PUBLIC_API, NEXT_PUBLIC_SITE → "NEXT_PUBLIC" (and a
// stray NEXT_AUTH_* member would pull it back to "NEXT").
//
// By default only ungrouped variables are considered, so a manual grouping is
// preserved; `overwrite` re-derives groups for every variable. Returns just the
// variables whose group should change (already-correct ones are omitted), so the
// caller can persist nothing when there is no work to do.
export function autoGroupAssignments(
  variables: Variable[],
  opts: { overwrite?: boolean } = {},
): { id: string; group: string }[] {
  const candidates = variables.filter((v) => opts.overwrite || v.group === null);

  // Cluster by leading segment, tracking distinct names (for the 2+ threshold)
  // and each distinct name's segments (for the longest common prefix).
  const clusters = new Map<string, { names: Set<string>; segLists: string[][] }>();
  for (const v of candidates) {
    const segs = segmentsOf(v.name);
    if (!segs) continue;
    const c = clusters.get(segs[0]!) ?? clusters.set(segs[0]!, { names: new Set(), segLists: [] }).get(segs[0]!)!;
    if (!c.names.has(v.name)) {
      c.names.add(v.name);
      c.segLists.push(segs);
    }
  }

  // A qualifying cluster's group name is the longest prefix its members all share.
  const groupByLeadingSeg = new Map<string, string>();
  for (const [seg, c] of clusters) {
    if (c.names.size >= 2) groupByLeadingSeg.set(seg, commonSegmentPrefix(c.segLists).join("_"));
  }

  const out: { id: string; group: string }[] = [];
  for (const v of candidates) {
    const segs = segmentsOf(v.name);
    if (!segs) continue;
    const group = groupByLeadingSeg.get(segs[0]!);
    if (group && v.group !== group) out.push({ id: v.id, group });
  }
  return out;
}
