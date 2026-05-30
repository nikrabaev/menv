import type { RepoModel, Variable } from "../core/types.ts";

export interface Store {
  getModel(): RepoModel;
  isDirty(): boolean;
  markClean(): void;
  subscribe(fn: () => void): () => void;
  setValue(varId: string, env: string, value: string): void;
  addVariable(v: Variable): void;
  deleteVariable(varId: string): void;
  toggleSecret(varId: string): void;
  setGroup(varId: string, group: string | null): void;
  setDescription(varId: string, description: string): void;
  wire(varId: string, consumerId: string, on: boolean): void;
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
    addVariable(v) { change({ ...model, variables: [...model.variables, v] }); },
    deleteVariable(varId) {
      const { [varId]: _, ...rest } = model.values;
      change({ ...model, variables: model.variables.filter((v) => v.id !== varId), values: rest });
    },
    toggleSecret(varId) { mapVar(varId, (v) => ({ ...v, secret: !v.secret })); },
    setGroup(varId, group) { mapVar(varId, (v) => ({ ...v, group })); },
    setDescription(varId, description) { mapVar(varId, (v) => ({ ...v, description })); },
    wire(varId, consumerId, on) {
      mapVar(varId, (v) => ({
        ...v,
        consumers: on
          ? [...new Set([...v.consumers, consumerId])]
          : v.consumers.filter((c) => c !== consumerId),
      }));
    },
  };
}
