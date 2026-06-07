import { join } from "node:path";
import { isApplied, resolveValue, varsForConsumer } from "../core/model.ts";
import type { RepoModel } from "../core/types.ts";
import { writeFileWithBackup as writeFile } from "./atomicWrite.ts";
import { writeComposeFiles } from "./compose.ts";
import { type SerializeEntry, serializeDotenv } from "./dotenv.ts";

// `local` selects which slice of the consumer's variables to emit: base vars go
// into `.env`/`.env.<env>`, local overrides into the matching `.local` file. The
// `local` flag breaks ties so a base var sorts before its local sibling.
function sortedVars(model: RepoModel, consumerId: string, local: boolean) {
  return [...varsForConsumer(model, consumerId)]
    .filter((v) => (v.local ?? false) === local)
    .sort((a, b) => {
      const g = (a.group ?? "~").localeCompare(b.group ?? "~");
      if (g !== 0) return g;
      const n = a.name.localeCompare(b.name);
      return n !== 0 ? n : Number(a.local ?? false) - Number(b.local ?? false);
    });
}

export function renderAppEnv(model: RepoModel, consumerId: string, env: string, local = false): string {
  const entries: SerializeEntry[] = sortedVars(model, consumerId, local).map((v) => ({
    key: v.name,
    value: resolveValue(model, v.id, env),
    description: v.description,
    group: v.group,
    // A variable wired to this consumer but not applied in `env` is written
    // commented-out, so it stays visible as a known-but-inactive variable.
    active: isApplied(v, consumerId, env),
  }));
  return serializeDotenv(entries, { groupHeaders: true });
}

export function renderAppExample(model: RepoModel, consumerId: string): string {
  // Overrides never belong in the shared template — base vars only.
  const entries: SerializeEntry[] = sortedVars(model, consumerId, false).map((v) => ({
    key: v.name,
    value: v.example ?? "",
    description: v.description,
    group: v.group,
  }));
  return serializeDotenv(entries, { groupHeaders: true });
}

// Writes each app its env file(s) plus a `.env.example`. In "single" mode (the
// default) one `.env` holds the active environment `env`; menv keeps every
// environment in the vault and materializes only the active one on disk (switch
// environments inside menv). In "perenv" mode one `.env.<env>` is written per
// environment the consumer actually has values in, side by side, and `env` is
// ignored for file selection.
export async function writeGeneratedFiles(model: RepoModel, env: string, stamp: string): Promise<string[]> {
  const written: string[] = [];
  for (const c of model.consumers) {
    if (c.kind !== "app" || !c.envFile) continue;
    const vars = varsForConsumer(model, c.id);
    // Skip consumers with nothing wired to them — keeps `init` from leaving a
    // stray empty `./.env` at the always-present root target (and empty app envs).
    if (vars.length === 0) continue;
    const baseVars = vars.filter((v) => !(v.local ?? false));
    const localVars = vars.filter((v) => v.local ?? false);
    // A local override file is the base file plus a `.local` suffix; it is only
    // written when there is actually a local value for that environment, so a
    // consumer with no overrides never sprouts an empty `.env.local`.
    const hasValIn = (list: typeof vars, e: string) =>
      list.some((v) => model.values[v.id]?.[e] !== undefined);
    if (c.envMode === "perenv") {
      // Only environments this consumer has data in get a file: environments are
      // global, so without this filter an unrelated env (one another app uses)
      // would leave a stray empty `.env.<env>` here. This also means menv
      // round-trips exactly the per-env files that existed at init.
      for (const e of model.environments) {
        if (baseVars.length && hasValIn(baseVars, e.id)) {
          written.push(await writeFile(model.root, join(c.path, `.env.${e.id}`), renderAppEnv(model, c.id, e.id), stamp));
        }
        if (localVars.length && hasValIn(localVars, e.id)) {
          written.push(await writeFile(model.root, join(c.path, `.env.${e.id}.local`), renderAppEnv(model, c.id, e.id, true), stamp));
        }
      }
    } else {
      if (baseVars.length) {
        written.push(await writeFile(model.root, join(c.path, c.envFile), renderAppEnv(model, c.id, env), stamp));
      }
      if (localVars.length && hasValIn(localVars, env)) {
        written.push(await writeFile(model.root, join(c.path, `${c.envFile}.local`), renderAppEnv(model, c.id, env, true), stamp));
      }
    }
    if (baseVars.length) {
      written.push(await writeFile(model.root, join(c.path, ".env.example"), renderAppExample(model, c.id), stamp));
    }
  }
  // Fill any docker-compose marker regions and write their .env.compose files.
  written.push(...(await writeComposeFiles(model, env, stamp)));
  return written;
}
