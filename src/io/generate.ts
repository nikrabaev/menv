import type { RepoModel } from "../core/types.ts";
import { varsForConsumer, valueOf } from "../core/model.ts";
import { serializeDotenv, type SerializeEntry } from "./dotenv.ts";

function entries(model: RepoModel, consumerId: string, env: string | null): SerializeEntry[] {
  const vars = [...varsForConsumer(model, consumerId)].sort((a, b) => {
    const g = (a.group ?? "~").localeCompare(b.group ?? "~");
    return g !== 0 ? g : a.name.localeCompare(b.name);
  });
  return vars.map((v) => ({
    key: v.name,
    value: env ? valueOf(model, v.id, env) : "",
    description: v.description,
    group: v.group,
  }));
}

export function renderAppEnv(model: RepoModel, consumerId: string, env: string): string {
  return serializeDotenv(entries(model, consumerId, env), { groupHeaders: true });
}

export function renderAppExample(model: RepoModel, consumerId: string): string {
  return serializeDotenv(entries(model, consumerId, null), { groupHeaders: true, valuesFree: true });
}
