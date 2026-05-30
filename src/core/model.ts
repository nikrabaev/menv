import type { RepoModel, Variable } from "./types.ts";

export function varsForConsumer(model: RepoModel, consumerId: string): Variable[] {
  return model.variables.filter((v) => v.consumers.includes(consumerId));
}

export function valueOf(model: RepoModel, varId: string, env: string): string {
  return model.values[varId]?.[env] ?? "";
}

export function appById(model: RepoModel, id: string) {
  return model.consumers.find((c) => c.id === id && c.kind === "app");
}
