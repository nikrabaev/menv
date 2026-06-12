import type { VaultSession } from "../vault/provider.ts";
import { MenvError } from "./errors.ts";

// Plan-then-execute (spec: "Contracts"). Every mutator computes a Plan, then
// either prints it (--dry-run) or executes it. Blockers fail execution unless
// --force; warnings always surface but never block.

export interface RegistryOp {
  action: "set" | "remove";
  path: string; // dotted path into menv.json, e.g. "variables.DATABASE_URL"
  summary: string;
}

export interface VaultOp {
  vault: string;
  action: "set" | "remove";
  key: string;
  // Present on "set" for execution; NEVER serialized into JSON output.
  value?: string;
}

export interface FileOp {
  action: "write" | "delete" | "release";
  path: string;
}

export interface PlanIssue {
  code: string; // e.g. "DEPENDENT_REFERENCE", "UNVERIFIED_REFERENCES"
  message: string;
}

export interface Plan {
  registry: RegistryOp[];
  vaults: VaultOp[];
  files: FileOp[];
  blockers: PlanIssue[];
  warnings: PlanIssue[];
}

export function emptyPlan(): Plan {
  return { registry: [], vaults: [], files: [], blockers: [], warnings: [] };
}

export function renderPlanPretty(plan: Plan): string {
  const lines: string[] = [];
  for (const op of plan.registry) lines.push(`registry ${op.action} ${op.path} — ${op.summary}`);
  for (const op of plan.vaults) lines.push(`vault ${op.vault}: ${op.action} ${op.key}`);
  for (const op of plan.files) lines.push(`file ${op.action} ${op.path}`);
  for (const w of plan.warnings) lines.push(`⚠ ${w.code}: ${w.message}`);
  for (const b of plan.blockers) lines.push(`✖ ${b.code}: ${b.message}`);
  return lines.length > 0 ? lines.join("\n") : "no changes";
}

// The machine-readable form. Vault op values are stripped: secrets never land
// in JSON plans (spec: output-modes contract) — keys identify the write.
export function planToJson(plan: Plan): object {
  return {
    registry: plan.registry,
    vaults: plan.vaults.map(({ value: _value, ...rest }) => rest),
    files: plan.files,
    blockers: plan.blockers,
    warnings: plan.warnings,
  };
}

export interface ExecuteContext {
  force?: boolean;
  sessions: ReadonlyMap<string, VaultSession>;
  // Saves the already-computed next registry. Runs AFTER vault ops so the
  // committed registry never references a key whose write failed; a failed
  // run can leave orphan vault keys, which `menv check` reports.
  commitRegistry?: () => Promise<void>;
  // IO-bound file-op applier provided by the CLI (core does no I/O). Called
  // for each plan.files entry after vault ops, before commitRegistry. Absent
  // ⇒ file ops stay descriptive (rendered in plans, executed by nobody).
  applyFileOp?: (op: FileOp) => Promise<void>;
}

export async function executePlan(plan: Plan, ctx: ExecuteContext): Promise<void> {
  if (plan.blockers.length > 0 && ctx.force !== true) {
    const summary = plan.blockers.map((b) => `${b.code}: ${b.message}`).join("; ");
    throw new MenvError("BLOCKED", `blocked — ${summary} (use --force to override)`, plan.blockers);
  }
  for (const op of plan.vaults) {
    const session = ctx.sessions.get(op.vault);
    if (session === undefined) {
      throw new MenvError("VAULT_IO", `no open session for vault "${op.vault}"`);
    }
    if (op.action === "set") await session.set(op.key, op.value ?? "");
    else await session.remove(op.key);
  }
  if (ctx.applyFileOp !== undefined) {
    for (const op of plan.files) await ctx.applyFileOp(op);
  }
  await ctx.commitRegistry?.();
}
