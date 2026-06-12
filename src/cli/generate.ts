import { MenvError } from "../core/errors.ts";
import type { PlanIssue } from "../core/plan.ts";
import { previewCompose } from "../generate/compose.ts";
import { applyPreview, previewGenerate, vaultsNeeded } from "../generate/generate.ts";
import type { Registry } from "../registry/types.ts";
import type { Io } from "./output.ts";
import { emitResult } from "./output.ts";
import type { MutationFlags, PromptFn } from "./run.ts";
import { openVaultSession } from "./run.ts";

export interface GenerateArgs {
  vault?: string;
  consumer?: string;
}

function prettyGenerate(
  res: { written: string[]; unchanged: string[]; refused: string[]; warnings: PlanIssue[] },
  dryRun: boolean,
): string {
  const lines = [
    `${dryRun ? "would write" : "wrote"}: ${res.written.length} · unchanged: ${res.unchanged.length} · refused: ${res.refused.length}`,
    ...res.written.map((p) => `  ${dryRun ? "~" : "+"} ${p}`),
    ...res.refused.map((p) => `  ! ${p} (exists without the menv marker — left as is)`),
    ...res.warnings.map((w) => `  ⚠ ${w.code}: ${w.message}`),
  ];
  return lines.join("\n");
}

// generate is the ONLY writer of generated files. It mutates neither registry
// nor vault, so it does not go through runMutation. Compose runs only on an
// unfiltered generate (no --consumer). Output reports PATHS, never content.
export async function runGenerate(
  root: string,
  registry: Registry,
  args: GenerateArgs,
  flags: MutationFlags,
  io: Io,
  promptFn?: PromptFn,
): Promise<void> {
  const runCompose = args.consumer === undefined && registry.compose.files.length > 0;
  const vaults = new Set(vaultsNeeded(registry, args));
  if (runCompose) vaults.add(args.vault ?? registry.defaults.vault);
  const sessions = new Map();
  try {
    for (const v of [...vaults].sort()) sessions.set(v, await openVaultSession(root, registry, v, flags, promptFn));
    const envPreview = await previewGenerate(root, registry, args, sessions);
    const composePreview = runCompose
      ? await previewCompose(root, registry, { vault: args.vault }, sessions)
      : { writes: [], errors: [] as PlanIssue[], warnings: [] as PlanIssue[] };
    if (composePreview.errors.length > 0) {
      throw new MenvError("VALIDATION", `compose: ${composePreview.errors.map((e) => e.message).join("; ")}`, composePreview.errors);
    }
    const writes = [...envPreview.writes, ...composePreview.writes];
    const result = {
      written: writes.map((w) => w.path),
      unchanged: envPreview.unchanged,
      refused: envPreview.refused,
      warnings: [...envPreview.warnings, ...composePreview.warnings],
    };
    if (flags.dryRun) {
      emitResult(io, flags.mode, { dryRun: true, ...result }, prettyGenerate(result, true));
      return;
    }
    await applyPreview(root, { ...envPreview, writes });
    emitResult(io, flags.mode, { applied: true, ...result }, prettyGenerate(result, false));
  } finally {
    await Promise.allSettled([...sessions.values()].map((s) => s.close()));
  }
}
