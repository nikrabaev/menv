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

export async function writeGeneratedFiles(model: RepoModel, stamp: string): Promise<string[]> {
  const written: string[] = [];
  for (const c of model.consumers) {
    if (c.kind !== "app") continue;
    for (const env of model.environments) {
      const filename = c.envFiles[env.id];
      if (!filename) continue;
      const rel = join(c.path, filename);
      written.push(await writeFile(model.root, rel, renderAppEnv(model, c.id, env.id), stamp));
    }
    if (Object.keys(c.envFiles).length > 0) {
      const exampleRel = join(c.path, ".env.example");
      written.push(await writeFile(model.root, exampleRel, renderAppExample(model, c.id), stamp));
    }
  }
  return written;
}
