import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hasOwnershipMarker } from "../generate/ownership.ts";
import { consumerPaths } from "../generate/paths.ts";
import { REGISTRY_FILENAME } from "../registry/persist.ts";
import type { Registry } from "../registry/types.ts";

const BACKUPS_DIR = ".menv/backups";

export function backupKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// A backup captures the registry, every menv-local vault file (ciphertext as
// is), and every menv-managed generated file (marker-bearing only — a file the
// user took over is theirs, not ours to snapshot).
export async function collectBackupPaths(root: string, registry: Registry): Promise<string[]> {
  const out = new Set<string>();
  if (await Bun.file(join(root, REGISTRY_FILENAME)).exists()) out.add(REGISTRY_FILENAME);
  for (const def of Object.values(registry.vaults)) {
    const cfg = def.vaultConfig as { filename?: string };
    if (def.vaultType === "menv-local" && typeof cfg.filename === "string" && (await Bun.file(join(root, cfg.filename)).exists())) {
      out.add(cfg.filename);
    }
  }
  const candidates = new Set<string>();
  for (const def of Object.values(registry.consumers)) {
    const p = consumerPaths(def);
    for (const c of [...p.main, ...p.local, ...(p.example !== undefined ? [p.example] : [])]) candidates.add(c);
  }
  for (const f of registry.compose.files) {
    candidates.add(join(dirname(f) === "." ? "" : dirname(f), ".env.compose"));
  }
  for (const rel of candidates) {
    const file = Bun.file(join(root, rel));
    if ((await file.exists()) && hasOwnershipMarker(await file.text())) out.add(rel);
  }
  return [...out].sort();
}

export async function createBackup(root: string, key: string, paths: string[]): Promise<string> {
  for (const rel of paths) {
    const dest = join(root, BACKUPS_DIR, key, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(root, rel), dest);
  }
  return join(BACKUPS_DIR, key);
}

export async function listBackups(root: string): Promise<string[]> {
  try {
    const entries = await readdir(join(root, BACKUPS_DIR), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

export async function restoreBackup(root: string, key: string): Promise<string[]> {
  const base = join(root, BACKUPS_DIR, key);
  const restored: string[] = [];
  const walk = async (relDir: string): Promise<void> => {
    for (const e of await readdir(join(base, relDir), { withFileTypes: true })) {
      const rel = relDir === "" ? e.name : join(relDir, e.name);
      if (e.isDirectory()) {
        await walk(rel);
      } else {
        const dest = join(root, rel);
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(join(base, rel), dest);
        restored.push(rel);
      }
    }
  };
  await walk("");
  return restored.sort();
}
