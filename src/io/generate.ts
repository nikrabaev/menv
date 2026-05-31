import { join, dirname } from "node:path";
import { mkdir, copyFile, rename } from "node:fs/promises";
import type { RepoModel } from "../core/types.ts";
import { varsForConsumer, valueOf } from "../core/model.ts";
import { serializeDotenv, type SerializeEntry } from "./dotenv.ts";

function sortedVars(model: RepoModel, consumerId: string) {
  return [...varsForConsumer(model, consumerId)].sort((a, b) => {
    const g = (a.group ?? "~").localeCompare(b.group ?? "~");
    return g !== 0 ? g : a.name.localeCompare(b.name);
  });
}

export function renderAppEnv(model: RepoModel, consumerId: string, env: string): string {
  const entries: SerializeEntry[] = sortedVars(model, consumerId).map((v) => ({
    key: v.name,
    value: valueOf(model, v.id, env),
    description: v.description,
    group: v.group,
  }));
  return serializeDotenv(entries, { groupHeaders: true });
}

export function renderAppExample(model: RepoModel, consumerId: string): string {
  const entries: SerializeEntry[] = sortedVars(model, consumerId).map((v) => ({
    key: v.name,
    value: v.example ?? "",
    description: v.description,
    group: v.group,
  }));
  return serializeDotenv(entries, { groupHeaders: true });
}

async function backupIfExists(root: string, rel: string, stamp: string): Promise<void> {
  const abs = join(root, rel);
  if (!(await Bun.file(abs).exists())) return;
  const dest = join(root, ".menv", "backups", stamp, rel);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(abs, dest);
}

async function writeFile(root: string, rel: string, content: string, stamp: string): Promise<string> {
  await backupIfExists(root, rel, stamp);
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = abs + ".menv-tmp";
  await Bun.write(tmp, content);
  await rename(tmp, abs);
  return rel;
}

// Writes each app a single `.env` holding the values of the active environment
// `env`, plus a `.env.example`. menv stores every environment in the vault; only
// the active one is materialized on disk (switch environments inside menv).
export async function writeGeneratedFiles(model: RepoModel, env: string, stamp: string): Promise<string[]> {
  const written: string[] = [];
  for (const c of model.consumers) {
    if (c.kind !== "app" || !c.envFile) continue;
    written.push(await writeFile(model.root, join(c.path, c.envFile), renderAppEnv(model, c.id, env), stamp));
    written.push(await writeFile(model.root, join(c.path, ".env.example"), renderAppExample(model, c.id), stamp));
  }
  return written;
}
