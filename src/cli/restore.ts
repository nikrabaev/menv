import { join } from "node:path";
import { backupExists, backupFiles, listBackups, restoreBackup } from "../io/backup.ts";

// The interactive surface, injected so runRestore is testable without Ink.
// selectBackup → null means the user cancelled; resolveConflicts → null likewise.
export interface RestorePrompts {
  selectBackup(keys: string[]): Promise<string | null>;
  resolveConflicts(conflicts: string[]): Promise<Record<string, boolean> | null>;
}

export interface RunRestoreResult {
  kind: "no-backups" | "not-found" | "cancelled" | "done";
  key?: string;
  restored?: string[];
  skipped?: string[];
  available?: string[];
}

export async function runRestore(
  root: string,
  opts: { key?: string; force?: boolean },
  prompts: RestorePrompts,
): Promise<RunRestoreResult> {
  // 1. Resolve which backup to restore.
  let key: string;
  if (opts.key) {
    if (!(await backupExists(root, opts.key))) {
      return { kind: "not-found", key: opts.key, available: await listBackups(root) };
    }
    key = opts.key;
  } else {
    const keys = await listBackups(root);
    if (keys.length === 0) return { kind: "no-backups" };
    const chosen = await prompts.selectBackup(keys);
    if (!chosen) return { kind: "cancelled" };
    key = chosen;
  }

  // 2. Only files that already exist on disk are conflicts worth prompting about.
  const files = await backupFiles(root, key);
  const conflicts: string[] = [];
  for (const rel of files) {
    if (await Bun.file(join(root, rel)).exists()) conflicts.push(rel);
  }

  // 3. Decide which conflicting files to overwrite. -f answers yes for all; an
  //    empty conflict set needs no prompt; cancelling aborts the whole restore.
  let answers: Record<string, boolean>;
  if (opts.force) {
    answers = Object.fromEntries(conflicts.map((rel) => [rel, true]));
  } else if (conflicts.length > 0) {
    const resolved = await prompts.resolveConflicts(conflicts);
    if (resolved === null) return { kind: "cancelled" };
    answers = resolved;
  } else {
    answers = {};
  }

  // 4. Existing files honor the answer; brand-new files always restore.
  const decide = (rel: string, exists: boolean) => (exists ? (answers[rel] ?? false) : true);
  const { restored, skipped } = await restoreBackup(root, key, decide);
  return { kind: "done", key, restored, skipped };
}
