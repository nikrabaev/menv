import { dirname, join } from "node:path";
import { expandAll } from "../core/interpolate.ts";
import type { PlanIssue } from "../core/plan.ts";
import type { Registry } from "../registry/types.ts";
import type { VaultSession } from "../vault/provider.ts";
import { globalsFor } from "./generate.ts";
import { disclaimerHeader } from "./ownership.ts";

export interface MarkerRegion {
  consumer: string;
  start: number; // index of the opening `# <menv:consumer>` line
  end: number; // index of the closing `# </menv>` line
  indent: string; // leading whitespace of the opening marker
}

const OPEN_RE = /^(\s*)#\s*<menv:([a-z0-9][a-z0-9._-]*)>\s*$/;
const CLOSE_RE = /^\s*#\s*<\/menv>\s*$/;

// Markers are hand-authored by the user; menv only discovers them and rewrites
// the lines between each pair. Structural errors are reported, never fixed.
export function findMarkerRegions(content: string): { regions: MarkerRegion[]; errors: string[] } {
  const lines = content.split("\n");
  const regions: MarkerRegion[] = [];
  const errors: string[] = [];
  let open: { consumer: string; start: number; indent: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const openM = line.match(OPEN_RE);
    if (openM) {
      if (open !== null) errors.push(`nested menv marker at line ${i + 1}`);
      open = { consumer: openM[2] as string, start: i, indent: openM[1] as string };
      continue;
    }
    if (CLOSE_RE.test(line)) {
      if (open === null) {
        errors.push(`unmatched </menv> at line ${i + 1}`);
        continue;
      }
      regions.push({ consumer: open.consumer, start: open.start, end: i, indent: open.indent });
      open = null;
    }
  }
  if (open !== null) errors.push(`unclosed <menv:${open.consumer}> marker`);
  return { regions, errors };
}

// Replaces each region's body (the lines strictly between its markers) with the
// supplied fill lines, keyed by the region's start index. Lines outside every
// region — including the marker lines themselves — are preserved verbatim.
export function spliceRegions(content: string, regions: MarkerRegion[], fillByStart: Map<number, string[]>): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let i = 0;
  const byStart = new Map(regions.map((r) => [r.start, r]));
  while (i < lines.length) {
    const region = byStart.get(i);
    if (region !== undefined) {
      out.push(lines[i] as string); // opening marker
      out.push(...(fillByStart.get(region.start) ?? []));
      out.push(lines[region.end] as string); // closing marker
      i = region.end + 1;
      continue;
    }
    out.push(lines[i] as string);
    i += 1;
  }
  return out.join("\n");
}

// The interpolation key for a (consumer, variable): consumer-prefixed so two
// services sharing one .env.compose never collide.
export function composeKey(consumer: string, name: string): string {
  return `${consumer.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${name}`;
}

interface ComposeValue {
  key: string;
  value: string;
  disabled: boolean;
}

export interface ComposePreview {
  writes: { path: string; content: string }[];
  errors: PlanIssue[];
  warnings: PlanIssue[];
}

// One compose pass over every registered file for the selected vault. Each
// file's marker regions are filled and a sibling .env.compose (the union of
// every region's values, disabled commented) is rendered.
export async function previewCompose(
  root: string,
  registry: Registry,
  opts: { vault?: string },
  sessions: ReadonlyMap<string, VaultSession>,
): Promise<ComposePreview> {
  const vault = opts.vault ?? registry.defaults.vault;
  const preview: ComposePreview = { writes: [], errors: [], warnings: [] };
  const session = sessions.get(vault);
  const globals = globalsFor(registry, vault);
  // Group compose files by directory so one .env.compose serves all files there.
  const valuesByDir = new Map<string, Map<string, ComposeValue>>();
  const splicedWrites: { path: string; content: string }[] = [];

  for (const file of registry.compose.files) {
    const abs = Bun.file(join(root, file));
    if (!(await abs.exists())) {
      preview.errors.push({ code: "MISSING_COMPOSE_FILE", message: `registered compose file not found: ${file}` });
      continue;
    }
    const content = await abs.text();
    const { regions, errors } = findMarkerRegions(content);
    for (const e of errors) preview.errors.push({ code: "COMPOSE_MARKER", message: `${file}: ${e}` });
    if (errors.length > 0) continue;
    if (regions.length === 0) {
      preview.warnings.push({ code: "COMPOSE_NO_MARKERS", message: `${file}: bound but has no menv markers` });
    }
    const dir = dirname(file) === "." ? "" : dirname(file);
    const dirValues = valuesByDir.get(dir) ?? new Map<string, ComposeValue>();
    valuesByDir.set(dir, dirValues);
    const fillByStart = new Map<number, string[]>();
    let fileFailed = false;
    for (const region of regions) {
      if (registry.consumers[region.consumer] === undefined) {
        preview.errors.push({
          code: "COMPOSE_UNKNOWN_CONSUMER",
          message: `${file}: marker names unknown consumer "${region.consumer}"`,
        });
        fileFailed = true;
        continue;
      }
      if (session === undefined) {
        preview.warnings.push({ code: "UNVERIFIED_VAULT", message: `vault "${vault}" could not be opened for compose` });
        fileFailed = true;
        continue;
      }
      const raw = new Map<string, string>();
      const meta: { name: string; disabled: boolean }[] = [];
      const names = Object.keys(registry.variables)
        .filter((n) => registry.variables[n]?.vaultMapping[vault]?.[region.consumer] !== undefined)
        .sort();
      for (const name of names) {
        const entry = registry.variables[name]?.vaultMapping[vault]?.[region.consumer];
        if (entry === undefined) continue;
        raw.set(name, (await session.get(entry.key)) ?? "");
        meta.push({ name, disabled: entry.disabled === true });
      }
      const expanded = expandAll({ values: raw, globals });
      const fill: string[] = [];
      for (const { name, disabled } of meta) {
        const key = composeKey(region.consumer, name);
        fill.push(`${region.indent}- ${name}=\${${key}}`);
        dirValues.set(key, { key, value: expanded.get(name) ?? "", disabled });
      }
      fillByStart.set(region.start, fill);
    }
    if (fileFailed) continue;
    splicedWrites.push({ path: file, content: spliceRegions(content, regions, fillByStart) });
  }

  if (preview.errors.length > 0) return { ...preview, writes: [] };
  preview.writes.push(...splicedWrites);
  for (const [dir, values] of valuesByDir) {
    const header = disclaimerHeader({ vault });
    const lines = [...values.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((v) => (v.disabled ? `# ${v.key}=${v.value}` : `${v.key}=${v.value}`));
    preview.writes.push({ path: join(dir, ".env.compose"), content: `${header}${lines.join("\n")}\n` });
  }
  return preview;
}
