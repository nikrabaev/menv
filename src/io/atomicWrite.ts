// Uses node:fs/promises for copyFile / atomic rename — Bun has no built-in equivalent — alongside Bun.file/Bun.write.
import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

// Copy an existing repo-relative file into .menv/backups/<stamp>/ before it is
// overwritten. A no-op when the file does not yet exist.
async function backupIfExists(root: string, rel: string, stamp: string): Promise<void> {
  const abs = join(root, rel);
  if (!(await Bun.file(abs).exists())) return;
  const dest = join(root, ".menv", "backups", stamp, rel);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(abs, dest);
}

// Write `content` to repo-relative `rel` atomically (tmp file + rename), backing up
// any existing copy first. Returns `rel` so callers can collect written paths.
export async function writeFileWithBackup(root: string, rel: string, content: string, stamp: string): Promise<string> {
  await backupIfExists(root, rel, stamp);
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.menv-tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, abs);
  return rel;
}
