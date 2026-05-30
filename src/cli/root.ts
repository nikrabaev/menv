import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(start: string): Promise<string> {
  let dir = resolve(start);
  while (true) {
    if (await exists(join(dir, "menv.toml"))) return dir;
    if (await exists(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}
