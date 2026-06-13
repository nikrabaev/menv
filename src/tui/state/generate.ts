// The generate flow: preview (would-write report) → apply the SAME preview.
// generate is the only writer of outputs; it never touches registry or vaults.
import { MenvError } from "../../core/errors.ts";
import type { PlanIssue } from "../../core/plan.ts";
import { previewCompose } from "../../generate/compose.ts";
import type { GeneratePreview } from "../../generate/generate.ts";
import { applyPreview, previewGenerate, vaultsNeeded } from "../../generate/generate.ts";
import type { VaultSession } from "../../vault/provider.ts";
import type { TuiContext } from "./data.ts";
import { loadFindings, openSession } from "./data.ts";
import { runAction, setStatus } from "./mutations.ts";
import type { Store } from "./store.tsx";

export interface GenerateScope {
  vault: string;
  consumer?: string; // consumer-scoped generate skips compose
}

export interface GenerateReport {
  scope: GenerateScope;
  written: string[]; // would-write paths in preview, written paths after apply
  unchanged: string[];
  refused: string[];
  warnings: PlanIssue[];
}

interface PendingGenerate {
  report: GenerateReport;
  envPreview: GeneratePreview;
  composeWrites: { path: string; content: string }[];
}

// Compute the full preview. Locked vaults throw AUTH_MISSING — callers gate on
// ensureUnlocked for the scope vault first; per-vault consumers may still need
// other vaults, surfaced here as an error status.
export async function computeGeneratePreview(
  store: Store,
  ctx: TuiContext,
  scope: GenerateScope,
): Promise<PendingGenerate> {
  const registry = store.getState().registry;
  const args = { vault: scope.vault, consumer: scope.consumer };
  const runCompose = scope.consumer === undefined && registry.compose.files.length > 0;
  const vaults = new Set(vaultsNeeded(registry, args));
  if (runCompose) vaults.add(scope.vault);
  const sessions = new Map<string, VaultSession>();
  try {
    for (const v of [...vaults].sort()) sessions.set(v, await openSession(ctx, registry, v));
    const envPreview = await previewGenerate(ctx.root, registry, args, sessions);
    const composePreview = runCompose
      ? await previewCompose(ctx.root, registry, { vault: scope.vault }, sessions)
      : { writes: [], errors: [] as PlanIssue[], warnings: [] as PlanIssue[] };
    if (composePreview.errors.length > 0) {
      throw new MenvError(
        "VALIDATION",
        `compose: ${composePreview.errors.map((e) => e.message).join("; ")}`,
        composePreview.errors,
      );
    }
    return {
      report: {
        scope,
        written: [...envPreview.writes, ...composePreview.writes].map((w) => w.path),
        unchanged: envPreview.unchanged,
        refused: envPreview.refused,
        warnings: [...envPreview.warnings, ...composePreview.warnings],
      },
      envPreview,
      composeWrites: composePreview.writes,
    };
  } finally {
    await Promise.allSettled([...sessions.values()].map((s) => s.close()));
  }
}

// Apply exactly what was previewed — no recompute between preview and apply.
export async function applyGenerate(store: Store, ctx: TuiContext, pending: PendingGenerate): Promise<void> {
  await applyPreview(ctx.root, {
    ...pending.envPreview,
    writes: [...pending.envPreview.writes, ...pending.composeWrites],
  });
  setStatus(
    store,
    "success",
    `generate: wrote ${pending.report.written.length} · unchanged ${pending.report.unchanged.length} · refused ${pending.report.refused.length}`,
  );
  const registry = store.getState().registry;
  void loadFindings(ctx, registry)
    .then((findings) => store.dispatch({ type: "findings", findings }))
    .catch(() => undefined);
}

// `c` — run the read-only health gate and show the findings overlay.
export function runCheckAction(store: Store, ctx: TuiContext): void {
  void runAction(store, "check", async () => {
    const findings = await loadFindings(ctx, store.getState().registry);
    store.dispatch({ type: "findings", findings });
    store.dispatch({ type: "pushModal", modal: { kind: "findings" } });
  });
}
