import { MenvError } from "../core/errors.ts";
import { backupKey, collectBackupPaths, createBackup, listBackups, restoreBackup } from "../io/backup.ts";
import type { Registry } from "../registry/types.ts";
import type { Io } from "./output.ts";
import { emitResult } from "./output.ts";
import type { MutationFlags } from "./run.ts";

export async function runBackup(root: string, registry: Registry, flags: MutationFlags, io: Io, now: Date = new Date()): Promise<void> {
  const key = backupKey(now);
  const paths = await collectBackupPaths(root, registry);
  const rel = await createBackup(root, key, paths);
  emitResult(io, flags.mode, { key, files: paths }, `Backup saved in ${rel} (${paths.length} files)`);
}

export interface RestoreDeps {
  isTTY: boolean;
  pick: (keys: string[]) => Promise<string>;
  confirm: (key: string) => Promise<boolean>;
}

// Non-interactive promise: with no TTY a key is required AND --force must be
// passed to skip the overwrite confirmation. On a TTY, pick/confirm prompt.
export async function runRestore(
  root: string,
  args: { key?: string; force: boolean },
  flags: MutationFlags,
  io: Io,
  deps: RestoreDeps,
): Promise<void> {
  const keys = await listBackups(root);
  if (keys.length === 0) throw new MenvError("NOT_FOUND", "no backups found");
  let key = args.key;
  if (key === undefined) {
    if (!deps.isTTY) throw new MenvError("VALIDATION", "restore needs a backup key (no TTY to pick one)");
    key = await deps.pick(keys);
  }
  if (!keys.includes(key)) {
    throw new MenvError("NOT_FOUND", `unknown backup "${key}" (have: ${keys.join(", ")})`);
  }
  if (!args.force) {
    if (!deps.isTTY) {
      throw new MenvError("VALIDATION", "restore overwrites files — pass --force to proceed without a TTY");
    }
    if (!(await deps.confirm(key))) {
      emitResult(io, flags.mode, { restored: [] }, "aborted");
      return;
    }
  }
  const restored = await restoreBackup(root, key);
  emitResult(io, flags.mode, { key, restored }, `restored ${restored.length} files from ${key}`);
}

// Minimal stdin line reader for the TTY pick/confirm (no Ink in v2.0).
async function readLine(promptText: string): Promise<string> {
  process.stderr.write(promptText);
  for await (const chunk of process.stdin) return new TextDecoder().decode(chunk as Uint8Array).trim();
  return "";
}

export const defaultRestoreDeps: RestoreDeps = {
  isTTY: process.stdin.isTTY === true,
  pick: async (keys) => {
    process.stderr.write(`${keys.map((k, i) => `  ${i + 1}) ${k}`).join("\n")}\n`);
    const ans = await readLine("restore which? (number or key): ");
    const idx = Number.parseInt(ans, 10);
    return Number.isNaN(idx) ? ans : (keys[idx - 1] ?? ans);
  },
  confirm: async (key) => (await readLine(`overwrite files from "${key}"? [y/N]: `)).toLowerCase().startsWith("y"),
};
