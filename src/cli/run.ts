import { MenvError } from "../core/errors.ts";
import type { OpResult } from "../core/ops/util.ts";
import { requireVault } from "../core/ops/util.ts";
import { executePlan, planToJson, renderPlanPretty } from "../core/plan.ts";
import type { ValueRecord } from "../core/refs.ts";
import { saveRegistry } from "../registry/persist.ts";
import type { Registry } from "../registry/types.ts";
import { resolveVaultAuthOptional } from "../vault/auth.ts";
import type { VaultSession } from "../vault/provider.ts";
import { getProvider } from "../vault/registry.ts";
import type { Io, OutputMode } from "./output.ts";
import { emitResult } from "./output.ts";

export interface AuthOpts {
  vaultAuth: Record<string, string>; // parsed --vault-auth <vault>=<secret> pairs
  env: Record<string, string | undefined>;
}

export interface MutationFlags extends AuthOpts {
  dryRun: boolean;
  force: boolean;
  mode: OutputMode;
}

export type PromptFn = (vaultName: string) => Promise<string>;

// Auth is resolved leniently (a plaintext vault needs none); if the provider
// then demands it (AUTH_MISSING) and we have a TTY prompt, ask once and retry.
// This keeps the resolution order flag > env > auth file > prompt > error.
export async function openVaultSession(
  root: string,
  registry: Registry,
  vaultName: string,
  auth: AuthOpts,
  promptFn?: PromptFn,
): Promise<VaultSession> {
  const def = requireVault(registry, vaultName);
  const provider = getProvider(def.vaultType);
  const resolved = await resolveVaultAuthOptional(vaultName, {
    root,
    flag: auth.vaultAuth[vaultName],
    env: auth.env,
  });
  try {
    return await provider.init(def.vaultConfig, { root, auth: resolved });
  } catch (e) {
    if (e instanceof MenvError && e.code === "AUTH_MISSING" && promptFn !== undefined) {
      return await provider.init(def.vaultConfig, { root, auth: { secret: await promptFn(vaultName) } });
    }
    throw e;
  }
}

export interface ValueScan {
  records: ValueRecord[];
  unverified: string[]; // vaults that exist but could not be opened
  openable: Set<string>;
  sessions: Map<string, VaultSession>; // kept open for reuse by runMutation
}

// Read every mapped value in the given vaults — the input to dependency
// scanning. Auth failures are a normal outcome here (→ unverified), not errors.
export async function collectValueRecords(
  root: string,
  registry: Registry,
  vaultNames: string[],
  auth: AuthOpts,
  promptFn?: PromptFn,
): Promise<ValueScan> {
  const records: ValueRecord[] = [];
  const unverified: string[] = [];
  const sessions = new Map<string, VaultSession>();
  for (const vault of [...new Set(vaultNames)].sort()) {
    let session: VaultSession;
    try {
      session = await openVaultSession(root, registry, vault, auth, promptFn);
    } catch (e) {
      if (e instanceof MenvError && (e.code === "AUTH_MISSING" || e.code === "AUTH_FAILED")) {
        unverified.push(vault);
        continue;
      }
      throw e;
    }
    sessions.set(vault, session);
    for (const [variable, def] of Object.entries(registry.variables)) {
      const byConsumer = def.vaultMapping[vault];
      if (byConsumer === undefined) continue;
      for (const [consumer, entry] of Object.entries(byConsumer)) {
        const raw = await session.get(entry.key);
        if (raw !== undefined) records.push({ variable, vault, consumer, raw });
      }
    }
  }
  return { records, unverified, openable: new Set(sessions.keys()), sessions };
}

export interface MutationExtras {
  result?: Record<string, unknown>; // merged into the JSON result
  pretty?: string; // appended to the pretty output
}

// The one path every mutating command goes through: dry-run prints the plan
// and stops; otherwise open the sessions the plan needs, execute, save the
// next registry, and report. Closes every session (passed-in ones included).
export async function runMutation(
  root: string,
  registry: Registry,
  op: OpResult,
  flags: MutationFlags,
  io: Io,
  sessions: Map<string, VaultSession> = new Map(),
  extras: MutationExtras = {},
  promptFn?: PromptFn,
): Promise<void> {
  const { next, plan } = op;
  try {
    if (flags.dryRun) {
      emitResult(
        io,
        flags.mode,
        { dryRun: true, plan: planToJson(plan), ...extras.result },
        `${renderPlanPretty(plan)}\n(dry run — nothing applied)${extras.pretty ? `\n${extras.pretty}` : ""}`,
      );
      return;
    }
    for (const vault of new Set(plan.vaults.map((o) => o.vault))) {
      if (!sessions.has(vault)) {
        sessions.set(vault, await openVaultSession(root, registry, vault, flags, promptFn));
      }
    }
    await executePlan(plan, {
      force: flags.force,
      sessions,
      commitRegistry: () => saveRegistry(root, next),
    });
    emitResult(
      io,
      flags.mode,
      { applied: true, plan: planToJson(plan), ...extras.result },
      `${renderPlanPretty(plan)}\napplied${extras.pretty ? `\n${extras.pretty}` : ""}`,
    );
  } finally {
    // allSettled: one rejecting close() must neither leak the other sessions
    // nor mask the primary result/error propagating out of the try.
    await Promise.allSettled([...sessions.values()].map((s) => s.close()));
  }
}
