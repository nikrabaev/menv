import type { EnvFileMode, RepoModel, Variable } from "../core/types.ts";

export interface Store {
  getModel(): RepoModel;
  isDirty(): boolean;
  markClean(): void;
  subscribe(fn: () => void): () => void;
  setValue(varId: string, env: string, value: string): void;
  setValues(varId: string, envs: string[], value: string): void;
  addVariable(v: Variable): void;
  deleteVariable(varId: string): void;
  toggleSecret(varId: string): void;
  setSecret(varId: string, on: boolean): void;
  setGroup(varId: string, group: string | null): void;
  setDescription(varId: string, description: string): void;
  setExample(varId: string, example: string): void;
  wire(varId: string, consumerId: string, on: boolean): void;
  setConsumers(varId: string, consumers: string[]): void;
  ensureEnvFile(consumerId: string): void;
  setEnvMode(consumerId: string, mode: EnvFileMode): void;
}

export function createStore(initial: RepoModel): Store {
  let model = initial;
  let dirty = false;
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((f) => f());
  const change = (next: RepoModel) => { model = next; dirty = true; notify(); };

  const mapVar = (varId: string, fn: (v: Variable) => Variable) =>
    change({ ...model, variables: model.variables.map((v) => (v.id === varId ? fn(v) : v)) });

  return {
    getModel: () => model,
    isDirty: () => dirty,
    markClean: () => { dirty = false; notify(); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    setValue(varId, env, value) {
      change({ ...model, values: { ...model.values, [varId]: { ...(model.values[varId] ?? {}), [env]: value } } });
    },
    setValues(varId, envs, value) {
      const next = { ...(model.values[varId] ?? {}) };
      for (const env of envs) next[env] = value;
      change({ ...model, values: { ...model.values, [varId]: next } });
    },
    addVariable(v) { change({ ...model, variables: [...model.variables, v] }); },
    deleteVariable(varId) {
      const { [varId]: _, ...rest } = model.values;
      change({ ...model, variables: model.variables.filter((v) => v.id !== varId), values: rest });
    },
    toggleSecret(varId) { mapVar(varId, (v) => ({ ...v, secret: !v.secret })); },
    setSecret(varId, on) { mapVar(varId, (v) => ({ ...v, secret: on })); },
    setGroup(varId, group) { mapVar(varId, (v) => ({ ...v, group })); },
    setDescription(varId, description) { mapVar(varId, (v) => ({ ...v, description })); },
    setExample(varId, example) { mapVar(varId, (v) => ({ ...v, example: example || undefined })); },
    wire(varId, consumerId, on) {
      mapVar(varId, (v) => ({
        ...v,
        consumers: on
          ? [...new Set([...v.consumers, consumerId])]
          : v.consumers.filter((c) => c !== consumerId),
      }));
    },
    setConsumers(varId, consumers) { mapVar(varId, (v) => ({ ...v, consumers: [...new Set(consumers)] })); },
    ensureEnvFile(consumerId) {
      // Wiring is an explicit intent to materialize: give the target an `.env`
      // output if it lacks one (e.g. an app that had no `.env` at init). The
      // zero-wired skip in generation keeps this from creating stray empty files.
      change({
        ...model,
        consumers: model.consumers.map((c) =>
          c.id === consumerId && c.kind === "app" && !c.envFile ? { ...c, envFile: ".env" } : c,
        ),
      });
    },
    setEnvMode(consumerId, mode) {
      // Switching to per-env implies "generate this consumer", so materialize an
      // envFile gate if it lacks one (mirrors ensureEnvFile). The derived `.env.<env>`
      // filenames don't use this value, but generation skips consumers without it.
      change({
        ...model,
        consumers: model.consumers.map((c) =>
          c.id === consumerId && c.kind === "app"
            ? { ...c, envMode: mode, envFile: mode === "perenv" ? c.envFile ?? ".env" : c.envFile }
            : c,
        ),
      });
    },
  };
}
