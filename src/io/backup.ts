import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

// Strict scope: only files named exactly `.env` and `.env.example` (not
// `.env.local`/`.env.production`/…). These are the files menv itself materializes.
const ENV_FILE_NAMES = [".env", ".env.example"];
// Excluded by path segment so a top-level `node_modules/` and a nested
// `apps/x/node_modules/` are both skipped. `.menv` is essential — otherwise a
// backup's own copies would be re-collected on the next run.
const EXCLUDE_SEGMENTS = new Set(["node_modules", ".git", ".menv"]);

const backupsDir = (root: string) => join(root, ".menv", "backups");

// Local wall-clock "YYYYMMDDHHmmss" (e.g. 20260112223049). Intentionally not the
// ISO-based stamp() in index.ts: that is UTC and a different shape.
export function backupKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    String(d.getFullYear()) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

// Repo-wide, relative paths of every `.env`/`.env.example`. Bun's matcher needs a
// separate glob per name (a combined `{**/.env,**/.env.example}` returns nothing)
// and ignores the `ignore` scan option, so exclusion is done here in code.
export async function collectEnvFiles(root: string): Promise<string[]> {
  const seen = new Set<string>();
  for (const name of ENV_FILE_NAMES) {
    const glob = new Bun.Glob(`**/${name}`);
    for await (const rel of glob.scan({ cwd: root, dot: true, onlyFiles: true })) {
      if (rel.split("/").some((seg) => EXCLUDE_SEGMENTS.has(seg))) continue;
      seen.add(rel);
    }
  }
  return [...seen].sort();
}

// Copies every collected file into .menv/backups/<key>/<rel>. The key dir is
// created even when there are no files, so the printed path always exists.
export async function createBackup(root: string, key: string): Promise<string[]> {
  const rels = await collectEnvFiles(root);
  const base = join(backupsDir(root), key);
  await mkdir(base, { recursive: true });
  for (const rel of rels) {
    const dest = join(base, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(root, rel), dest);
  }
  return rels;
}

// Backup keys, newest first. Empty when no backups have been taken.
export async function listBackups(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(backupsDir(root), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
}

export async function backupExists(root: string, key: string): Promise<boolean> {
  try {
    return (await stat(join(backupsDir(root), key))).isDirectory();
  } catch {
    return false;
  }
}

// Relative paths held inside a given backup (recurses to mirror nested layouts).
export async function backupFiles(root: string, key: string): Promise<string[]> {
  const base = join(backupsDir(root), key);
  const out: string[] = [];
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({ cwd: base, dot: true, onlyFiles: true })) {
    out.push(rel);
  }
  return out.sort();
}

export interface RestoreResult {
  restored: string[];
  skipped: string[];
}

// Copies each backed-up file back to its repo location, asking `decide` whether to
// write. `decide` is the single seam where force / yes-all / per-file / "always
// restore a brand-new file" policy is applied. mkdir handles a since-deleted parent.
export async function restoreBackup(
  root: string,
  key: string,
  decide: (rel: string, targetExists: boolean) => boolean,
): Promise<RestoreResult> {
  const base = join(backupsDir(root), key);
  const rels = await backupFiles(root, key);
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const rel of rels) {
    const target = join(root, rel);
    const targetExists = await Bun.file(target).exists();
    if (!decide(rel, targetExists)) {
      skipped.push(rel);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(base, rel), target);
    restored.push(rel);
  }
  return { restored, skipped };
}
