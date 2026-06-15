// The TUI's mutation bridge: build a planner OpResult, surface it in the plan
// modal, and on confirm run it through the same executePlan path as the CLI —
// then refresh registry/vault/findings state. Also hosts the "flows": helpers
// views call to start a form → plan → apply interaction.
import { join } from "node:path";
import { collectValueRecords } from "../../cli/run.ts";
import { MenvError } from "../../core/errors.ts";
import { planComposeBind, planComposeUnbind } from "../../core/ops/compose.ts";
import { planConsumerAdd, planConsumerRemove, planConsumerUpdate } from "../../core/ops/consumer.ts";
import { planGlobalDefine, planGlobalRemove, planGlobalUpdate } from "../../core/ops/global.ts";
import { planGroupAdd, planGroupRemove, planGroupUpdate } from "../../core/ops/group.ts";
import { planImportEntries } from "../../core/ops/importOps.ts";
import type { OpResult } from "../../core/ops/util.ts";
import { mergePlans, newPlan } from "../../core/ops/util.ts";
import { planSetUniqueValue, planSetValue, resolveMappingKey } from "../../core/ops/value.ts";
import { planVarDefine, planVarRemove, planVarUpdate } from "../../core/ops/variable.ts";
import { planVaultAdd, planVaultRemove, planVaultUpdate } from "../../core/ops/vault.ts";
import { planSetDisabled, planUnwire, planWire } from "../../core/ops/wiring.ts";
import { executePlan } from "../../core/plan.ts";
import { applyFileOp } from "../../generate/apply.ts";
import { consumerPaths } from "../../generate/paths.ts";
import { backupKey, collectBackupPaths, createBackup, restoreBackup } from "../../io/backup.ts";
import { parseDotenv } from "../../io/dotenv.ts";
import { upsertManagedBlock } from "../../io/gitignore.ts";
import { saveRegistry } from "../../registry/persist.ts";
import type { VaultSession } from "../../vault/provider.ts";
import { getProvider } from "../../vault/registry.ts";
import type { TuiContext } from "./data.ts";
import { authOpts, loadBackupList, loadFindings, loadVaultRuntime, openSession, reloadRegistry } from "./data.ts";
import type { FormSpec, Store } from "./store.tsx";

const newKey = (): string => crypto.randomUUID();

// ── plumbing ─────────────────────────────────────────────────────────────────

export function setStatus(store: Store, tone: "info" | "success" | "error", text: string): void {
  store.dispatch({ type: "status", status: { tone, text } });
}

// Async action wrapper: busy spinner + MenvError → status line, never a crash.
export async function runAction(store: Store, label: string, fn: () => Promise<void>): Promise<void> {
  store.dispatch({ type: "busy", busy: label });
  try {
    await fn();
  } catch (e) {
    if (e instanceof MenvError) setStatus(store, "error", `${e.code}: ${e.message}`);
    else setStatus(store, "error", `unexpected: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    store.dispatch({ type: "busy", busy: null });
  }
}

export async function refreshAfterApply(store: Store, ctx: TuiContext, vaults?: string[]): Promise<void> {
  const registry = await reloadRegistry(ctx);
  store.dispatch({ type: "registry", registry });
  const names = vaults ?? Object.keys(registry.vaults);
  for (const name of names) {
    if (registry.vaults[name] === undefined) continue;
    store.dispatch({ type: "vaultRuntime", vault: name, runtime: await loadVaultRuntime(ctx, registry, name) });
  }
  // Drift indicators stay honest: re-check in the background (never prompts).
  void loadFindings(ctx, registry)
    .then((findings) => store.dispatch({ type: "findings", findings }))
    .catch(() => undefined);
}

async function closeAll(sessions: Iterable<VaultSession>): Promise<void> {
  await Promise.allSettled([...sessions].map((s) => s.close()));
}

// Execute an already-planned op: open the needed sessions, run, refresh.
export async function applyOpNow(store: Store, ctx: TuiContext, op: OpResult, force: boolean): Promise<void> {
  const registry = store.getState().registry;
  const sessions = new Map<string, VaultSession>();
  try {
    for (const vault of new Set(op.plan.vaults.map((o) => o.vault))) {
      sessions.set(vault, await openSession(ctx, registry, vault));
    }
    await executePlan(op.plan, {
      force,
      sessions,
      commitRegistry: () => saveRegistry(ctx.root, op.next),
      applyFileOp: (fileOp) => applyFileOp(ctx.root, fileOp),
    });
  } finally {
    await closeAll(sessions.values());
  }
  await refreshAfterApply(store, ctx, [...new Set(op.plan.vaults.map((o) => o.vault))]);
}

function planIsEmpty(op: OpResult): boolean {
  const p = op.plan;
  return (
    p.registry.length === 0 &&
    p.vaults.length === 0 &&
    p.files.length === 0 &&
    p.blockers.length === 0 &&
    p.warnings.length === 0
  );
}

// The plan → confirm → apply gate every mutation goes through.
export function requestPlan(
  store: Store,
  ctx: TuiContext,
  title: string,
  op: OpResult,
  opts: { danger?: string; onApplied?: () => void | Promise<void> } = {},
): void {
  if (planIsEmpty(op)) {
    setStatus(store, "info", `${title}: no changes`);
    return;
  }
  store.dispatch({
    type: "pushModal",
    modal: {
      kind: "plan",
      title,
      op,
      danger: opts.danger,
      apply: async (force) => {
        await runAction(store, title, async () => {
          await applyOpNow(store, ctx, op, force);
          setStatus(store, "success", `${title}: applied`);
          await opts.onApplied?.();
        });
      },
    },
  });
}

// Gate an interaction on an unlocked vault: locked → unlock modal, then go on.
export function ensureUnlocked(store: Store, ctx: TuiContext, vault: string, then: () => void): void {
  const runtime = store.getState().vaults[vault];
  if (runtime !== undefined && runtime.unlocked) {
    then();
    return;
  }
  store.dispatch({ type: "pushModal", modal: { kind: "unlock", vault, onUnlocked: then } });
}

// Called by the unlock modal with the typed passphrase. Throws AUTH_FAILED back
// to the modal on a wrong passphrase (it stays open).
export async function tryUnlock(store: Store, ctx: TuiContext, vault: string, secret: string): Promise<void> {
  const registry = store.getState().registry;
  const def = registry.vaults[vault];
  if (def === undefined) throw new MenvError("NOT_FOUND", `unknown vault "${vault}"`);
  const session = await getProvider(def.vaultType).init(def.vaultConfig, { root: ctx.root, auth: { secret } });
  await session.close();
  ctx.auth.set(vault, secret);
  store.dispatch({ type: "vaultRuntime", vault, runtime: await loadVaultRuntime(ctx, registry, vault) });
  // A fresh unlock may unblock skipped checks.
  void loadFindings(ctx, registry)
    .then((findings) => store.dispatch({ type: "findings", findings }))
    .catch(() => undefined);
}

function pushForm(store: Store, form: FormSpec): void {
  store.dispatch({ type: "pushModal", modal: { kind: "form", form } });
}

const splitList = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");

function parsePairs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of splitList(raw)) {
    const eq = part.indexOf("=");
    if (eq < 1) throw new MenvError("VALIDATION", `expected <key>=<value>[,…], got "${part}"`);
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

// Dependency scan for unwire / var remove / global remove. Sessions opened by
// the scan are closed immediately — apply reopens what the plan needs.
async function scanValues(
  store: Store,
  ctx: TuiContext,
  vaults: string[],
): Promise<{ records: Awaited<ReturnType<typeof collectValueRecords>>["records"]; unverified: string[]; openable: Set<string> }> {
  const scan = await collectValueRecords(ctx.root, store.getState().registry, vaults, authOpts(ctx));
  await closeAll(scan.sessions.values());
  return { records: scan.records, unverified: scan.unverified, openable: scan.openable };
}

// ── vault flows ──────────────────────────────────────────────────────────────

export function startVaultAdd(store: Store, ctx: TuiContext): void {
  pushForm(store, {
    title: "Add vault",
    fields: [
      { name: "name", label: "name", kind: "text", required: true, placeholder: "production" },
      // Only menv-local ships in v2.0; the field stays a select so more types slot in.
      { name: "vaultType", label: "type", kind: "select", options: [{ label: "menv-local", value: "menv-local" }] },
      { name: "filename", label: "file", kind: "text", required: true, placeholder: ".menv/vault.production.json" },
      { name: "encryption", label: "encrypted (committable)", kind: "toggle", initial: "true" },
    ],
    onSubmit: (v) => {
      const encryption = v.encryption === "true";
      const op = planVaultAdd(store.getState().registry, {
        name: v.name ?? "",
        vaultType: v.vaultType ?? "menv-local",
        vaultConfig: { filename: v.filename ?? "", encryption },
      });
      requestPlan(store, ctx, `vault add ${v.name}`, op, {
        onApplied: async () => {
          // Same hygiene as the CLI: a plaintext vault file must stay untracked.
          if (!encryption && v.filename !== undefined) await upsertManagedBlock(ctx.root, [v.filename]);
        },
      });
    },
  });
}

export function startVaultEdit(store: Store, ctx: TuiContext, name: string): void {
  const def = store.getState().registry.vaults[name];
  if (def === undefined) return;
  const cfg = def.vaultConfig as { filename?: string; encryption?: boolean };
  pushForm(store, {
    title: `Edit vault ${name}`,
    fields: [
      { name: "filename", label: "file", kind: "text", initial: cfg.filename ?? "" },
      { name: "encryption", label: "encrypted (committable)", kind: "toggle", initial: cfg.encryption === false ? "false" : "true" },
    ],
    onSubmit: (v) => {
      const op = planVaultUpdate(store.getState().registry, {
        name,
        config: { filename: v.filename ?? "", encryption: v.encryption === "true" },
      });
      requestPlan(store, ctx, `vault update ${name}`, op);
    },
  });
}

export function vaultSetDefault(store: Store, ctx: TuiContext, name: string): void {
  const op = planVaultUpdate(store.getState().registry, { name, makeDefault: true });
  requestPlan(store, ctx, `make ${name} the default vault`, op);
}

export function vaultRemove(store: Store, ctx: TuiContext, name: string): void {
  const op = planVaultRemove(store.getState().registry, { name });
  requestPlan(store, ctx, `vault remove ${name}`, op, {
    danger: "removes the vault from the registry — the vault store file itself is never deleted",
  });
}

// ── consumer flows ───────────────────────────────────────────────────────────

function consumerFormFields(initial?: { baseDir: string; filename?: string; filenames?: string; secrets?: boolean; example?: boolean }) {
  return [
    { name: "baseDir", label: "base dir", kind: "text" as const, required: true, initial: initial?.baseDir, placeholder: "apps/api" },
    { name: "filename", label: "filename (single)", kind: "text" as const, initial: initial?.filename, placeholder: ".env" },
    { name: "filenames", label: "filenames (per-vault v=f,…)", kind: "text" as const, initial: initial?.filenames },
    { name: "secretsAsLocalOverrides", label: "secrets → <file>.local", kind: "toggle" as const, initial: initial?.secrets === true ? "true" : "false" },
    { name: "example", label: "emit .env.example", kind: "toggle" as const, initial: initial?.example === true ? "true" : "false" },
  ];
}

export function startConsumerAdd(store: Store, ctx: TuiContext): void {
  pushForm(store, {
    title: "Add consumer (fill filename OR filenames)",
    fields: [
      { name: "name", label: "name", kind: "text", required: true, placeholder: "api" },
      ...consumerFormFields(),
    ],
    onSubmit: (v) => {
      const perVault = (v.filenames ?? "") !== "";
      const op = planConsumerAdd(store.getState().registry, {
        name: v.name ?? "",
        strategyType: perVault ? "per-vault" : "single",
        baseDir: v.baseDir ?? "",
        filename: perVault || (v.filename ?? "") === "" ? undefined : v.filename,
        filenames: perVault ? parsePairs(v.filenames ?? "") : undefined,
        secretsAsLocalOverrides: v.secretsAsLocalOverrides === "true",
        example: v.example === "true",
      });
      requestPlan(store, ctx, `consumer add ${v.name}`, op);
    },
  });
}

export function startConsumerEdit(store: Store, ctx: TuiContext, name: string): void {
  const def = store.getState().registry.consumers[name];
  if (def === undefined) return;
  const initial =
    def.strategyType === "single"
      ? { baseDir: def.strategyConfig.baseDir, filename: def.strategyConfig.filename, secrets: def.strategyConfig.secretsAsLocalOverrides, example: def.strategyConfig.example }
      : {
          baseDir: def.strategyConfig.baseDir,
          filenames: Object.entries(def.strategyConfig.filenames)
            .map(([k, v]) => `${k}=${v}`)
            .join(","),
          secrets: def.strategyConfig.secretsAsLocalOverrides,
          example: def.strategyConfig.example,
        };
  pushForm(store, {
    title: `Edit consumer ${name} (${def.strategyType})`,
    fields: consumerFormFields(initial),
    onSubmit: (v) => {
      const op = planConsumerUpdate(store.getState().registry, {
        name,
        baseDir: v.baseDir,
        filename: def.strategyType === "single" && (v.filename ?? "") !== "" ? v.filename : undefined,
        filenames: def.strategyType === "per-vault" && (v.filenames ?? "") !== "" ? parsePairs(v.filenames ?? "") : undefined,
        secretsAsLocalOverrides: v.secretsAsLocalOverrides === "true",
        example: v.example === "true",
      });
      requestPlan(store, ctx, `consumer update ${name}`, op);
    },
  });
}

export function startConsumerRemove(store: Store, ctx: TuiContext, name: string): void {
  pushForm(store, {
    title: `Remove consumer ${name}`,
    fields: [
      {
        name: "deleteFiles",
        label: "delete generated files (off = release: strip marker, keep content)",
        kind: "toggle",
        initial: "false",
      },
    ],
    submitLabel: "plan removal",
    onSubmit: async (v) => {
      const registry = store.getState().registry;
      const def = registry.consumers[name];
      if (def === undefined) return;
      const wiredVaults = Object.keys(registry.vaults).filter((vault) =>
        Object.values(registry.variables).some((vd) => vd.vaultMapping[vault]?.[name] !== undefined),
      );
      const scan = await scanValues(store, ctx, wiredVaults);
      const paths = consumerPaths(def);
      const op = planConsumerRemove(registry, {
        name,
        openable: scan.openable,
        paths: [...paths.main, ...paths.local, ...(paths.example !== undefined ? [paths.example] : [])],
        deleteFiles: v.deleteFiles === "true",
      });
      requestPlan(store, ctx, `consumer remove ${name}`, op, {
        danger:
          v.deleteFiles === "true"
            ? "DELETES this consumer's generated files from disk"
            : "releases generated files (marker stripped, content kept) and empties its compose regions",
      });
    },
  });
}

// ── group flows ──────────────────────────────────────────────────────────────

export function startGroupAdd(store: Store, ctx: TuiContext): void {
  pushForm(store, {
    title: "Add group",
    fields: [
      { name: "key", label: "key", kind: "text", required: true, placeholder: "db" },
      { name: "title", label: "title", kind: "text", required: true, placeholder: "Database" },
    ],
    onSubmit: (v) => {
      const op = planGroupAdd(store.getState().registry, { key: v.key ?? "", title: v.title ?? "" });
      requestPlan(store, ctx, `group add ${v.key}`, op);
    },
  });
}

export function startGroupEdit(store: Store, ctx: TuiContext, key: string): void {
  const def = store.getState().registry.groups[key];
  if (def === undefined) return;
  pushForm(store, {
    title: `Edit group ${key}`,
    fields: [{ name: "title", label: "title", kind: "text", required: true, initial: def.title }],
    onSubmit: (v) => {
      const op = planGroupUpdate(store.getState().registry, { key, title: v.title ?? "" });
      requestPlan(store, ctx, `group update ${key}`, op);
    },
  });
}

export function groupRemove(store: Store, ctx: TuiContext, key: string): void {
  const op = planGroupRemove(store.getState().registry, { key });
  requestPlan(store, ctx, `group remove ${key}`, op, {
    danger: "variables using this group keep working — forcing clears their groupKey",
  });
}

// ── global flows ─────────────────────────────────────────────────────────────

export function startGlobalForm(store: Store, ctx: TuiContext, mode: "define" | "update", name?: string): void {
  const state = store.getState();
  const vault = state.activeVault;
  const existing = name !== undefined ? state.registry.globals[name]?.values[vault] : undefined;
  pushForm(store, {
    title: mode === "define" ? `Define global (vault ${vault})` : `Update global ${name} (vault ${vault})`,
    fields: [
      ...(mode === "define"
        ? [{ name: "name", label: "name", kind: "text" as const, required: true, placeholder: "COMPOSE_PROJECT_NAME" }]
        : []),
      {
        name: "source",
        label: "source",
        kind: "select",
        options: [
          { label: "runtime (platform supplies it)", value: "runtime" },
          { label: "static (menv substitutes a value)", value: "static" },
        ],
        initial: existing?.source ?? "runtime",
      },
      { name: "value", label: "static value", kind: "text", initial: existing?.source === "static" ? existing.value : "" },
      { name: "description", label: "description", kind: "text", initial: name !== undefined ? (state.registry.globals[name]?.description ?? "") : "" },
    ],
    onSubmit: (v) => {
      const input = {
        name: mode === "define" ? (v.name ?? "") : (name ?? ""),
        vault,
        source: (v.source ?? "runtime") as "runtime" | "static",
        value: v.source === "static" ? (v.value ?? "") : undefined,
        description: (v.description ?? "") === "" ? undefined : v.description,
      };
      const op =
        mode === "define" ? planGlobalDefine(store.getState().registry, input) : planGlobalUpdate(store.getState().registry, input);
      requestPlan(store, ctx, `global ${mode} ${input.name}`, op);
    },
  });
}

export function startGlobalRemove(store: Store, ctx: TuiContext, name: string): void {
  const state = store.getState();
  const def = state.registry.globals[name];
  if (def === undefined) return;
  const definedVaults = Object.keys(def.values).sort();
  pushForm(store, {
    title: `Remove global ${name}`,
    fields: [
      {
        name: "vault",
        label: "scope",
        kind: "select",
        options: [
          { label: "all vaults", value: "" },
          ...definedVaults.map((v) => ({ label: `only vault ${v}`, value: v })),
        ],
      },
    ],
    submitLabel: "plan removal",
    onSubmit: async (v) => {
      const affected = (v.vault ?? "") === "" ? definedVaults : [v.vault as string];
      const scan = await scanValues(store, ctx, affected);
      const op = planGlobalRemove(store.getState().registry, {
        name,
        vault: (v.vault ?? "") === "" ? undefined : v.vault,
        records: scan.records,
        unverified: scan.unverified,
      });
      requestPlan(store, ctx, `global remove ${name}`, op, {
        danger: "forcing past blockers leaves dangling ${refs} that `check` flags",
      });
    },
  });
}

// ── variable flows ───────────────────────────────────────────────────────────

function groupOptions(store: Store): { label: string; value: string }[] {
  return [
    { label: "(none)", value: "" },
    ...Object.entries(store.getState().registry.groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, g]) => ({ label: `${g.title} (${key})`, value: key })),
  ];
}

export function startVarDefine(store: Store, ctx: TuiContext): void {
  pushForm(store, {
    title: "Define variable",
    fields: [
      { name: "name", label: "name", kind: "text", required: true, placeholder: "DATABASE_URL" },
      { name: "groupKey", label: "group", kind: "select", options: groupOptions(store) },
      { name: "secret", label: "secret (masked everywhere)", kind: "toggle", initial: "false" },
      { name: "description", label: "description", kind: "text" },
      { name: "example", label: "example", kind: "text" },
    ],
    onSubmit: (v) => {
      const op = planVarDefine(store.getState().registry, {
        name: v.name ?? "",
        groupKey: (v.groupKey ?? "") === "" ? undefined : v.groupKey,
        secret: v.secret === "true" ? true : undefined,
        description: (v.description ?? "") === "" ? undefined : v.description,
        example: (v.example ?? "") === "" ? undefined : v.example,
      });
      requestPlan(store, ctx, `var define ${v.name}`, op);
    },
  });
}

export function startVarEdit(store: Store, ctx: TuiContext, name: string): void {
  const def = store.getState().registry.variables[name];
  if (def === undefined) return;
  pushForm(store, {
    title: `Edit variable ${name}`,
    fields: [
      { name: "groupKey", label: "group", kind: "select", options: groupOptions(store), initial: def.groupKey ?? "" },
      { name: "secret", label: "secret (masked everywhere)", kind: "toggle", initial: def.secret === true ? "true" : "false" },
      { name: "description", label: "description", kind: "text", initial: def.description ?? "" },
      { name: "example", label: "example", kind: "text", initial: def.example ?? "" },
    ],
    onSubmit: (v) => {
      const op = planVarUpdate(store.getState().registry, {
        name,
        groupKey: (v.groupKey ?? "") === "" ? undefined : v.groupKey,
        clearGroup: (v.groupKey ?? "") === "" && def.groupKey !== undefined ? true : undefined,
        secret: v.secret === "true",
        description: v.description ?? "",
        example: v.example ?? "",
      });
      requestPlan(store, ctx, `var update ${name}`, op);
    },
  });
}

export function startVarRemove(store: Store, ctx: TuiContext, name: string): void {
  void runAction(store, `var remove ${name}`, async () => {
    const def = store.getState().registry.variables[name];
    if (def === undefined) return;
    const scan = await scanValues(store, ctx, Object.keys(def.vaultMapping));
    const op = planVarRemove(store.getState().registry, {
      name,
      records: scan.records,
      unverified: scan.unverified,
      openable: scan.openable,
    });
    requestPlan(store, ctx, `var remove ${name}`, op, {
      danger: "removes the definition, all wirings, and its vault keys; forcing past blockers leaves dangling ${refs}",
    });
  });
}

export function startWire(store: Store, ctx: TuiContext, name: string): void {
  const state = store.getState();
  const vault = state.activeVault;
  const wired = new Set(Object.keys(state.registry.variables[name]?.vaultMapping[vault] ?? {}));
  const candidates = Object.keys(state.registry.consumers)
    .filter((c) => !wired.has(c))
    .sort();
  if (candidates.length === 0) {
    setStatus(store, "info", `"${name}" is already wired to every consumer in vault "${vault}"`);
    return;
  }
  pushForm(store, {
    title: `Wire ${name} (vault ${vault})`,
    fields: [
      { name: "consumers", label: `consumers (comma list of: ${candidates.join(", ")})`, kind: "text", required: true, initial: candidates.length === 1 ? candidates[0] : "" },
      {
        name: "mode",
        label: "key allocation",
        kind: "select",
        options: [
          { label: "fresh key per consumer (independent values)", value: "fresh" },
          { label: "one shared key (one value for all listed)", value: "shared" },
          { label: "join an existing key", value: "key" },
        ],
      },
      { name: "key", label: "existing key (for join)", kind: "text" },
    ],
    onSubmit: (v) => {
      const op = planWire(store.getState().registry, {
        name,
        vault,
        consumers: splitList(v.consumers ?? ""),
        shared: v.mode === "shared" ? true : undefined,
        key: v.mode === "key" ? v.key : undefined,
        newKey,
      });
      requestPlan(store, ctx, `wire ${name}`, op);
    },
  });
}

export function startUnwire(store: Store, ctx: TuiContext, name: string, vault: string, consumer?: string): void {
  const state = store.getState();
  const wired = Object.keys(state.registry.variables[name]?.vaultMapping[vault] ?? {}).sort();
  if (wired.length === 0) {
    setStatus(store, "info", `"${name}" is not wired in vault "${vault}"`);
    return;
  }
  const plansFor = (consumers: string[]): void => {
    void runAction(store, `unwire ${name}`, async () => {
      const scan = await scanValues(store, ctx, [vault]);
      const finish = (removeOrphans: boolean): void => {
        const op = planUnwire(store.getState().registry, {
          name,
          vault,
          consumers,
          records: scan.records,
          unverified: scan.unverified,
          openable: scan.openable,
          removeOrphans,
        });
        requestPlan(store, ctx, `unwire ${name} (vault ${vault})`, op);
      };
      const orphans = orphanedKeys(store.getState().registry, vault, name, consumers);
      if (orphans.length > 0 && scan.openable.has(vault)) promptOrphans(store, vault, orphans, finish);
      else finish(false);
    });
  };
  if (consumer !== undefined) {
    plansFor([consumer]);
    return;
  }
  pushForm(store, {
    title: `Unwire ${name} (vault ${vault})`,
    fields: [{ name: "consumers", label: `consumers (comma list of: ${wired.join(", ")})`, kind: "text", required: true, initial: wired.join(",") }],
    onSubmit: (v) => plansFor(splitList(v.consumers ?? "")),
  });
}

// Pick the (single) consumer an action applies to, asking only when ambiguous.
function withConsumer(store: Store, name: string, vault: string, preset: string | undefined, title: string, then: (consumer: string) => void): void {
  const wired = Object.keys(store.getState().registry.variables[name]?.vaultMapping[vault] ?? {}).sort();
  if (wired.length === 0) {
    setStatus(store, "error", `"${name}" is not wired in vault "${vault}"`);
    return;
  }
  if (preset !== undefined && wired.includes(preset)) {
    then(preset);
    return;
  }
  if (wired.length === 1) {
    then(wired[0] as string);
    return;
  }
  store.dispatch({ type: "pushModal", modal: { kind: "consumerPick", title, consumers: wired, onPick: then } });
}

export function toggleDisabled(store: Store, ctx: TuiContext, name: string, vault: string, consumer?: string): void {
  withConsumer(store, name, vault, consumer, `${name}: which consumer?`, (c) => {
    const entry = store.getState().registry.variables[name]?.vaultMapping[vault]?.[c];
    if (entry === undefined) return;
    const disabled = !(entry.disabled === true);
    const op = planSetDisabled(store.getState().registry, { name, vault, consumer: c, disabled });
    requestPlan(store, ctx, `${disabled ? "disable" : "enable"} ${name} for ${c}`, op);
  });
}

export function startSetValue(store: Store, ctx: TuiContext, name: string, vault: string, consumer?: string): void {
  const state = store.getState();
  const def = state.registry.variables[name];
  if (def === undefined) return;
  const mapping = def.vaultMapping[vault] ?? {};
  const byKey = new Map<string, string[]>();
  for (const [c, e] of Object.entries(mapping)) byKey.set(e.key, [...(byKey.get(e.key) ?? []), c]);
  if (byKey.size === 0) {
    setStatus(store, "error", `"${name}" is not wired in vault "${vault}" — wire it first (w)`);
    return;
  }
  const ask = (chosenConsumer?: string): void => {
    ensureUnlocked(store, ctx, vault, () => {
      const secret = def.secret === true;
      const { key, consumers } = resolveMappingKey(store.getState().registry, { name, vault, consumer: chosenConsumer });
      const current = store.getState().vaults[vault]?.values?.[key];
      pushForm(store, {
        title: `Set ${name} (vault ${vault}${consumers.length > 1 ? `, shared by ${consumers.join(", ")}` : `, ${consumers[0]}`})`,
        fields: [
          {
            name: "value",
            label: secret ? "value (secret — masked)" : "value",
            kind: secret ? "password" : "text",
            // Never prefill: secrets must not echo, and a prefilled non-secret
            // can only be appended to in a line editor. Show it as a hint.
            placeholder: !secret && current !== undefined ? `current: ${current}` : undefined,
            required: false,
          },
        ],
        onSubmit: (v) => {
          const op = planSetValue(store.getState().registry, { name, vault, consumer: chosenConsumer, value: v.value ?? "" });
          requestPlan(store, ctx, `set ${name}`, op);
        },
      });
    });
  };
  // Distinct keys per consumer → the choice is the user's, never a guess.
  if (consumer !== undefined && mapping[consumer] !== undefined) ask(consumer);
  else if (byKey.size === 1) ask(undefined);
  else
    store.dispatch({
      type: "pushModal",
      modal: { kind: "consumerPick", title: `${name} holds different values per consumer — set which?`, consumers: Object.keys(mapping).sort(), onPick: ask },
    });
}

// Human-mode value editing: a single consumer's (consumer, value) row. Unlock
// first so the modal can show the current value and the values held by other
// consumers, then open the dedicated editor.
export function startValueEdit(store: Store, ctx: TuiContext, name: string, vault: string, consumer: string): void {
  const entry = store.getState().registry.variables[name]?.vaultMapping[vault]?.[consumer];
  if (entry === undefined) {
    setStatus(store, "error", `"${name}" is not wired to "${consumer}" in vault "${vault}"`);
    return;
  }
  ensureUnlocked(store, ctx, vault, () => {
    store.dispatch({ type: "pushModal", modal: { kind: "valueEdit", name, vault, consumer } });
  });
}

// Keys this variable's mapping would leave unreferenced in `vault` once
// `consumers` are removed (the orphan check `planUnwire`/`planWire` apply).
function orphanedKeys(registry: Store["state"]["registry"], vault: string, name: string, leaving: string[], rekeyTo?: string): string[] {
  const mapping = registry.variables[name]?.vaultMapping[vault] ?? {};
  const freed = new Set(leaving.map((c) => mapping[c]?.key).filter((k): k is string => k !== undefined));
  const surviving = new Set<string>();
  for (const [c, e] of Object.entries(mapping)) {
    if (leaving.includes(c)) continue;
    surviving.add(e.key);
  }
  if (rekeyTo !== undefined) surviving.add(rekeyTo); // the re-keyed consumer now holds this
  return [...freed].filter((k) => !surviving.has(k) && k !== rekeyTo).sort();
}

function promptOrphans(store: Store, vault: string, keys: string[], onChoose: (remove: boolean) => void): void {
  store.dispatch({ type: "pushModal", modal: { kind: "orphanPrompt", vault, keys, onChoose } });
}

// Compose the value-editor's result into one confirm. Three mutually-exclusive
// value moves: adopt a key (share storage with its holders), set a unique value
// (isolate onto a private key), or leave the value alone — plus the disabled
// flag. Adopting can orphan the consumer's old key; we prompt before dropping it.
export function applyValueEdit(
  store: Store,
  ctx: TuiContext,
  name: string,
  vault: string,
  consumer: string,
  change: { adoptKey?: string; value?: string; disabled: boolean },
): void {
  const registry = store.getState().registry;
  const entry = registry.variables[name]?.vaultMapping[vault]?.[consumer];
  if (entry === undefined) {
    setStatus(store, "error", `"${name}" is not wired to "${consumer}" in vault "${vault}"`);
    return;
  }

  const withDisabled = (valueOp: OpResult | null): OpResult => {
    const base = valueOp?.next ?? registry;
    const wasDisabled = base.variables[name]?.vaultMapping[vault]?.[consumer]?.disabled === true;
    const disabledOp = change.disabled !== wasDisabled ? planSetDisabled(base, { name, vault, consumer, disabled: change.disabled }) : null;
    return {
      next: disabledOp?.next ?? valueOp?.next ?? registry,
      plan: mergePlans(valueOp?.plan ?? newPlan(), disabledOp?.plan ?? newPlan()),
    };
  };
  const title = `edit ${name} · ${consumer} (vault ${vault})`;

  if (change.adoptKey !== undefined && change.adoptKey !== entry.key) {
    const orphans = orphanedKeys(registry, vault, name, [consumer], change.adoptKey);
    const finish = (removeOrphans: boolean): void => {
      const wireOp = planWire(registry, {
        name,
        vault,
        consumers: [consumer],
        key: change.adoptKey,
        newKey,
        removeOrphans,
        openable: new Set([vault]),
      });
      requestPlan(store, ctx, title, withDisabled(wireOp));
    };
    if (orphans.length > 0) promptOrphans(store, vault, orphans, finish);
    else finish(false);
    return;
  }

  const valueOp = change.value !== undefined ? planSetUniqueValue(registry, { name, vault, consumer, value: change.value, newKey }) : null;
  requestPlan(store, ctx, title, withDisabled(valueOp));
}

export function startReveal(store: Store, ctx: TuiContext, name: string, vault: string, consumer?: string): void {
  const state = store.getState();
  const def = state.registry.variables[name];
  if (def === undefined) return;
  const mapping = def.vaultMapping[vault] ?? {};
  const byKey = new Map<string, string[]>();
  for (const [c, e] of Object.entries(mapping)) byKey.set(e.key, [...(byKey.get(e.key) ?? []), c]);
  if (byKey.size === 0) {
    setStatus(store, "error", `"${name}" is not wired in vault "${vault}"`);
    return;
  }
  const reveal = (chosenConsumer?: string): void => {
    ensureUnlocked(store, ctx, vault, () => {
      const { key } = resolveMappingKey(store.getState().registry, { name, vault, consumer: chosenConsumer });
      const value = store.getState().vaults[vault]?.values?.[key];
      if (value === undefined) {
        setStatus(store, "error", `no value stored for "${name}" in vault "${vault}"`);
        return;
      }
      const show = (): void =>
        store.dispatch({ type: "pushModal", modal: { kind: "reveal", variable: name, vault, consumer: chosenConsumer, value } });
      if (def.secret === true) {
        store.dispatch({
          type: "pushModal",
          modal: { kind: "confirm", title: "Reveal secret", body: `Show the raw value of "${name}" (vault "${vault}") on screen?`, danger: true, onConfirm: show },
        });
      } else show();
    });
  };
  if (consumer !== undefined && mapping[consumer] !== undefined) reveal(consumer);
  else if (byKey.size === 1) reveal(undefined);
  else
    store.dispatch({
      type: "pushModal",
      modal: { kind: "consumerPick", title: `${name} holds different values per consumer — reveal which?`, consumers: Object.keys(mapping).sort(), onPick: reveal },
    });
}

// ── compose flows ────────────────────────────────────────────────────────────

export function startComposeBind(store: Store, ctx: TuiContext): void {
  pushForm(store, {
    title: "Bind compose file (markers inside it are hand-authored: # <menv:consumer> … # </menv>)",
    fields: [{ name: "file", label: "file", kind: "text", required: true, placeholder: "docker-compose.yml" }],
    onSubmit: (v) => {
      const op = planComposeBind(store.getState().registry, { file: v.file ?? "" });
      requestPlan(store, ctx, `compose bind ${v.file}`, op, {
        onApplied: async () => {
          // Mirror the CLI: the sibling .env.compose carries decrypted values.
          const dir = (v.file ?? "").includes("/") ? (v.file ?? "").slice(0, (v.file ?? "").lastIndexOf("/")) : "";
          await upsertManagedBlock(ctx.root, [dir === "" ? ".env.compose" : join(dir, ".env.compose")]);
        },
      });
    },
  });
}

export function composeUnbind(store: Store, ctx: TuiContext, file: string): void {
  const op = planComposeUnbind(store.getState().registry, { file });
  requestPlan(store, ctx, `compose unbind ${file}`, op);
}

// ── import flow ──────────────────────────────────────────────────────────────

export function startImport(store: Store, ctx: TuiContext): void {
  const state = store.getState();
  const consumers = Object.keys(state.registry.consumers).sort();
  const vaults = Object.keys(state.registry.vaults).sort();
  if (consumers.length === 0) {
    setStatus(store, "error", "no consumers yet — add one first (sidebar, a)");
    return;
  }
  pushForm(store, {
    title: "Import a dotenv file (define + wire + set per entry)",
    fields: [
      { name: "file", label: "file", kind: "text", required: true, placeholder: "apps/api/.env.old" },
      { name: "consumer", label: "consumer", kind: "select", options: consumers.map((c) => ({ label: c, value: c })) },
      { name: "vault", label: "vault", kind: "select", options: vaults.map((v) => ({ label: v, value: v })), initial: state.activeVault },
    ],
    onSubmit: async (v) => {
      const vault = v.vault ?? state.activeVault;
      ensureUnlocked(store, ctx, vault, () => {
        void runAction(store, "import", async () => {
          const file = Bun.file(join(ctx.root, v.file ?? ""));
          if (!(await file.exists())) throw new MenvError("NOT_FOUND", `no such file: ${v.file}`);
          const entries = parseDotenv(await file.text());
          if (entries.length === 0) {
            setStatus(store, "info", `${v.file}: nothing to import`);
            return;
          }
          const registry = store.getState().registry;
          // Prefetch current values of already-wired keys (conflict detection).
          const currentValues = new Map<string, string>();
          const session = await openSession(ctx, registry, vault);
          try {
            for (const { key: name } of entries) {
              const entry = registry.variables[name]?.vaultMapping[vault]?.[v.consumer ?? ""];
              if (entry === undefined) continue;
              const raw = await session.get(entry.key);
              if (raw !== undefined) currentValues.set(entry.key, raw);
            }
          } finally {
            await session.close();
          }
          const { result, report } = planImportEntries(registry, {
            entries,
            consumer: v.consumer ?? "",
            vault,
            currentValues,
            force: false,
            newKey,
          });
          requestPlan(store, ctx, `import ${v.file} → ${v.consumer} (vault ${vault})`, result, {
            danger: `defines ${report.defined.length}, wires ${report.wired.length}, updates ${report.updated.length}, skips ${report.skipped.length}`,
          });
        });
      });
    },
  });
}

// ── backup / restore ─────────────────────────────────────────────────────────

export function backupNow(store: Store, ctx: TuiContext): void {
  void runAction(store, "backup", async () => {
    const registry = store.getState().registry;
    const key = backupKey(new Date());
    const paths = await collectBackupPaths(ctx.root, registry);
    await createBackup(ctx.root, key, paths);
    store.dispatch({ type: "backups", backups: await loadBackupList(ctx) });
    setStatus(store, "success", `backup ${key}: ${paths.length} file(s)`);
  });
}

export function startRestore(store: Store, ctx: TuiContext, key: string): void {
  store.dispatch({
    type: "pushModal",
    modal: {
      kind: "confirm",
      title: `Restore backup ${key}`,
      body: "Overwrites menv.json, vault files, and managed generated files with the snapshot. Continue?",
      danger: true,
      onConfirm: async () => {
        await runAction(store, "restore", async () => {
          const restored = await restoreBackup(ctx.root, key);
          await refreshAfterApply(store, ctx);
          setStatus(store, "success", `restored ${restored.length} file(s) from ${key}`);
        });
      },
    },
  });
}
