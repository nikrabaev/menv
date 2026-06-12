import { join } from "node:path";
import type { GlobalResolution } from "../core/interpolate.ts";
import { expandAll } from "../core/interpolate.ts";
import type { PlanIssue } from "../core/plan.ts";
import { writeFileAtomic } from "../io/write.ts";
import type { Registry } from "../registry/types.ts";
import type { VaultSession } from "../vault/provider.ts";
import { disclaimerHeader, hasOwnershipMarker } from "./ownership.ts";
import { envTargets } from "./paths.ts";
import type { RenderEntry } from "./render.ts";
import { renderEnvContent, renderExampleContent, splitSecrets } from "./render.ts";

export interface GenerateOpts {
  vault?: string;
  consumer?: string;
}

export interface GeneratePreview {
  writes: { path: string; content: string }[];
  unchanged: string[];
  refused: string[]; // existing files without the ownership marker
  warnings: PlanIssue[];
}

export function globalsFor(registry: Registry, vault: string): Map<string, GlobalResolution> {
  const out = new Map<string, GlobalResolution>();
  for (const [name, def] of Object.entries(registry.globals)) {
    const v = def.values[vault];
    if (v === undefined) continue;
    out.set(name, v.source === "static" ? { kind: "static", value: v.value } : { kind: "runtime" });
  }
  return out;
}

// Vaults a generate over these options will read from (env targets only;
// compose adds the selected vault, which envTargets already covers for
// single-mode consumers — the CLI unions in the compose vault when needed).
export function vaultsNeeded(registry: Registry, opts: GenerateOpts): string[] {
  return [...new Set(envTargets(registry.consumers, registry.defaults, opts).map((t) => t.vault))].sort();
}

// All wired entries for one (consumer, vault) scope, values fetched and
// interpolation-expanded. Missing values render empty + MISSING_VALUE warning.
export async function scopeEntries(
  registry: Registry,
  consumer: string,
  vault: string,
  session: VaultSession,
  warnings: PlanIssue[],
): Promise<RenderEntry[]> {
  const raw = new Map<string, string>();
  const meta: { name: string; disabled: boolean }[] = [];
  for (const [name, def] of Object.entries(registry.variables)) {
    const entry = def.vaultMapping[vault]?.[consumer];
    if (entry === undefined) continue;
    const value = await session.get(entry.key);
    if (value === undefined) {
      warnings.push({
        code: "MISSING_VALUE",
        message: `"${name}" has no value in vault "${vault}" (consumer "${consumer}") — rendered empty`,
      });
    }
    raw.set(name, value ?? "");
    meta.push({ name, disabled: entry.disabled === true });
  }
  const expanded = expandAll({ values: raw, globals: globalsFor(registry, vault) });
  return meta.map(({ name, disabled }) => {
    const def = registry.variables[name];
    return {
      name,
      value: expanded.get(name) ?? "",
      disabled,
      secret: def?.secret === true,
      groupKey: def?.groupKey,
      example: def?.example,
    };
  });
}

async function classify(
  root: string,
  path: string,
  content: string,
  preview: GeneratePreview,
): Promise<void> {
  const file = Bun.file(join(root, path));
  if (await file.exists()) {
    const existing = await file.text();
    if (existing === content) {
      preview.unchanged.push(path);
      return;
    }
    if (!hasOwnershipMarker(existing)) {
      preview.refused.push(path); // the user took ownership — never overwrite
      return;
    }
  }
  preview.writes.push({ path, content });
}

// Computes every file a generate would write. Pure-ish: reads vaults via the
// passed sessions and the disk only to classify (unchanged/refused). Throws
// VALIDATION (unresolved ref / cycle) before ANY write is possible.
export async function previewGenerate(
  root: string,
  registry: Registry,
  opts: GenerateOpts,
  sessions: ReadonlyMap<string, VaultSession>,
): Promise<GeneratePreview> {
  const preview: GeneratePreview = { writes: [], unchanged: [], refused: [], warnings: [] };
  const exampleDone = new Set<string>();
  for (const target of envTargets(registry.consumers, registry.defaults, opts)) {
    const session = sessions.get(target.vault);
    if (session === undefined) continue; // CLI opens all vaultsNeeded; defensive
    const entries = await scopeEntries(registry, target.consumer, target.vault, session, preview.warnings);
    const def = registry.consumers[target.consumer];
    if (def === undefined) continue;
    const header = disclaimerHeader({ vault: target.vault, consumer: target.consumer });
    const { main, local } = splitSecrets(entries, target.secretsSplit);
    await classify(root, target.relPath, renderEnvContent(main, registry.groups, header), preview);
    if (target.secretsSplit) {
      await classify(root, `${target.relPath}.local`, renderEnvContent(local, registry.groups, header), preview);
    }
    if (def.strategyConfig.example === true && !exampleDone.has(target.consumer)) {
      exampleDone.add(target.consumer);
      // The example documents the full wired surface across vaults: union of
      // names wired anywhere, values-free.
      const names = new Set<string>();
      for (const [name, v] of Object.entries(registry.variables)) {
        for (const byConsumer of Object.values(v.vaultMapping)) {
          if (byConsumer[target.consumer] !== undefined) names.add(name);
        }
      }
      const exampleEntries: RenderEntry[] = [...names].map((name) => {
        const v = registry.variables[name];
        return {
          name,
          value: "",
          disabled: false,
          secret: v?.secret === true,
          groupKey: v?.groupKey,
          example: v?.example,
        };
      });
      const examplePath = join(def.strategyConfig.baseDir, ".env.example");
      const exampleHeader = disclaimerHeader({ consumer: target.consumer });
      await classify(root, examplePath, renderExampleContent(exampleEntries, registry.groups, exampleHeader), preview);
    }
  }
  return preview;
}

export async function applyPreview(root: string, preview: GeneratePreview): Promise<void> {
  for (const w of preview.writes) await writeFileAtomic(root, w.path, w.content);
}
