// I/O loaders shared by startup, reloads, and post-mutation refreshes. The
// TUI session context carries the in-memory auth map: passphrases the user
// typed into the unlock modal live ONLY here, never in React state and never
// on disk.
import type { CheckAuth, Finding } from "../../cli/check.ts";
import { collectFindings } from "../../cli/check.ts";
import { openVaultSession } from "../../cli/run.ts";
import { MenvError } from "../../core/errors.ts";
import { listBackups } from "../../io/backup.ts";
import { loadRegistry } from "../../registry/persist.ts";
import type { Registry } from "../../registry/types.ts";
import type { VaultSession } from "../../vault/provider.ts";
import type { VaultRuntime } from "./store.tsx";

export interface TuiContext {
  root: string;
  env: Record<string, string | undefined>;
  // vault name → secret. Seeded from --vault-auth pairs; grown by the unlock
  // modal. In-memory only.
  auth: Map<string, string>;
}

export function authOpts(ctx: TuiContext): CheckAuth {
  return { vaultAuth: Object.fromEntries(ctx.auth), env: ctx.env };
}

export async function openSession(ctx: TuiContext, registry: Registry, vault: string): Promise<VaultSession> {
  return await openVaultSession(ctx.root, registry, vault, authOpts(ctx));
}

// Every key any variable maps to in this vault — the snapshot we display from.
function referencedKeys(registry: Registry, vault: string): string[] {
  const keys = new Set<string>();
  for (const def of Object.values(registry.variables)) {
    for (const entry of Object.values(def.vaultMapping[vault] ?? {})) keys.add(entry.key);
  }
  return [...keys];
}

// Open (without ever prompting), snapshot referenced values, close. Auth
// failures are the normal "locked" outcome, not errors.
export async function loadVaultRuntime(ctx: TuiContext, registry: Registry, vault: string): Promise<VaultRuntime> {
  let session: VaultSession;
  try {
    session = await openSession(ctx, registry, vault);
  } catch (e) {
    if (e instanceof MenvError && (e.code === "AUTH_MISSING" || e.code === "AUTH_FAILED")) {
      return { unlocked: false, values: null };
    }
    throw e;
  }
  try {
    const values: Record<string, string> = {};
    for (const key of referencedKeys(registry, vault)) {
      const v = await session.get(key);
      if (v !== undefined) values[key] = v;
    }
    return { unlocked: true, values };
  } finally {
    await session.close();
  }
}

export async function loadAllVaults(ctx: TuiContext, registry: Registry): Promise<Record<string, VaultRuntime>> {
  const out: Record<string, VaultRuntime> = {};
  for (const name of Object.keys(registry.vaults).sort()) {
    out[name] = await loadVaultRuntime(ctx, registry, name);
  }
  return out;
}

export async function loadFindings(ctx: TuiContext, registry: Registry): Promise<Finding[]> {
  return await collectFindings(ctx.root, registry, authOpts(ctx));
}

export async function loadBackupList(ctx: TuiContext): Promise<string[]> {
  return await listBackups(ctx.root);
}

export async function reloadRegistry(ctx: TuiContext): Promise<Registry> {
  return await loadRegistry(ctx.root);
}
