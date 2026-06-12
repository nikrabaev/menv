import type { GroupDef } from "../registry/types.ts";

// Pure rendering: entries in, file text out. No I/O, no registry walking —
// the orchestrator (generate.ts) assembles RenderEntry lists per scope.
export interface RenderEntry {
  name: string;
  value: string; // already interpolation-expanded
  disabled: boolean;
  secret: boolean;
  groupKey?: string;
  example?: string;
}

type Groups = Record<string, GroupDef>;

// Sections: groups in registry order (only those present), ungrouped last.
function sections(entries: RenderEntry[], groups: Groups): { title: string | null; entries: RenderEntry[] }[] {
  const byName = (a: RenderEntry, b: RenderEntry) => a.name.localeCompare(b.name);
  const out: { title: string | null; entries: RenderEntry[] }[] = [];
  for (const [key, def] of Object.entries(groups)) {
    const members = entries.filter((e) => e.groupKey === key).sort(byName);
    if (members.length > 0) out.push({ title: def.title, entries: members });
  }
  const ungrouped = entries.filter((e) => e.groupKey === undefined || groups[e.groupKey] === undefined).sort(byName);
  if (ungrouped.length > 0) out.push({ title: null, entries: ungrouped });
  return out;
}

export function renderEnvContent(entries: RenderEntry[], groups: Groups, header: string): string {
  const blocks = sections(entries, groups).map(({ title, entries: members }) => {
    const lines = members.map((e) => (e.disabled ? `# ${e.name}=${e.value}` : `${e.name}=${e.value}`));
    return (title !== null ? [`# ── ${title} ──`, ...lines] : lines).join("\n");
  });
  return blocks.length > 0 ? `${header}${blocks.join("\n\n")}\n` : header;
}

export function splitSecrets(
  entries: RenderEntry[],
  secretsAsLocalOverrides: boolean,
): { main: RenderEntry[]; local: RenderEntry[] } {
  if (!secretsAsLocalOverrides) return { main: entries, local: [] };
  return { main: entries.filter((e) => !e.secret), local: entries.filter((e) => e.secret) };
}

// .env.example documents the full wired surface, values-free: every entry
// (disabled included) as NAME=<example or empty>, never commented.
export function renderExampleContent(entries: RenderEntry[], groups: Groups, header: string): string {
  const templated = entries.map((e) => ({ ...e, value: e.example ?? "", disabled: false }));
  return renderEnvContent(templated, groups, header);
}
