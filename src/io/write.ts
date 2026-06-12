// node:fs/promises for mkdir/rename — Bun has no built-in atomic rename.
import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

// Atomic write (tmp + rename). Deliberately NO before-write backup: v2 never
// snapshots implicitly (spec requirement 3); `menv backup` is the only backup.
export async function writeFileAtomic(
  root: string,
  rel: string,
  content: string | Uint8Array,
): Promise<string> {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.menv-tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, abs);
  return rel;
}
