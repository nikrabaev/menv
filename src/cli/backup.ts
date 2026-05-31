import { createBackup } from "../io/backup.ts";

// Snapshots every .env/.env.example into .menv/backups/<key>. Returns the relative
// backup path (for the exact "Backup saved in …" line) and the files copied.
export async function runBackup(
  root: string,
  opts: { key: string },
): Promise<{ key: string; rel: string; files: string[] }> {
  const files = await createBackup(root, opts.key);
  return { key: opts.key, rel: `.menv/backups/${opts.key}`, files };
}
