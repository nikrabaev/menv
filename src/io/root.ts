import { dirname, join } from "node:path";
import { REGISTRY_FILENAME } from "../registry/persist.ts";

// Walk from `start` toward the filesystem root looking for menv.json. Returns
// the containing directory, or null when this is not (inside) a menv repo —
// `init` then treats the cwd as the new root; everything else errors.
export async function findRoot(start: string): Promise<string | null> {
  let dir = start;
  while (true) {
    if (await Bun.file(join(dir, REGISTRY_FILENAME)).exists()) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
