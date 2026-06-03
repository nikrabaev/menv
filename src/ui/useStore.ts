import { useSyncExternalStore } from "react";
import type { RepoModel } from "../core/types.ts";
import type { Store } from "../store/store.ts";

export function useModel(store: Store): RepoModel {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getModel(),
  );
}

export function useDirty(store: Store): boolean {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.isDirty(),
  );
}
