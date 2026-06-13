// App state: one reducer + React context. All I/O lives in data.ts/mutations.ts
// (async helpers that dispatch); components stay pure render + key handling.
import type React from "react";
import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import type { Finding } from "../../cli/check.ts";
import type { OpResult } from "../../core/ops/util.ts";
import type { Registry } from "../../registry/types.ts";

export type PaneId = "sidebar" | "main" | "inspector";
export type MainTab = "variables" | "globals" | "groups" | "compose" | "backups";
export const MAIN_TABS: MainTab[] = ["variables", "globals", "groups", "compose", "backups"];

export interface VaultRuntime {
  encrypted: boolean | undefined; // undefined: non-local provider
  unlocked: boolean;
  values: Record<string, string> | null; // key → value snapshot; null while locked
}

// Modal descriptors. `plan` carries the apply closure built by mutations.ts —
// state is never serialized, so closures are fine here.
export type Modal =
  | { kind: "help" }
  | { kind: "quit" }
  | {
      kind: "plan";
      title: string;
      op: OpResult;
      danger?: string; // consequence text for destructive actions
      apply: (force: boolean) => Promise<void>;
    }
  | { kind: "confirm"; title: string; body: string; danger?: boolean; onConfirm: () => void | Promise<void> }
  | { kind: "unlock"; vault: string; onUnlocked?: () => void }
  | { kind: "form"; form: FormSpec }
  | { kind: "reveal"; variable: string; vault: string; consumer?: string; value: string }
  | { kind: "consumerPick"; title: string; consumers: string[]; onPick: (consumer: string) => void }
  | { kind: "findings" }
  | { kind: "generate" }
  | { kind: "detail" }; // narrow-terminal inspector modal

// A generic field-list form rendered by modals/formModal.tsx.
export interface FormField {
  name: string;
  label: string;
  kind: "text" | "password" | "select" | "toggle";
  options?: { label: string; value: string }[]; // for select
  initial?: string;
  placeholder?: string;
  required?: boolean;
}

export interface FormSpec {
  title: string;
  fields: FormField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
}

export interface StatusMessage {
  tone: "info" | "success" | "error";
  text: string;
}

export interface AppState {
  registry: Registry;
  activeVault: string;
  consumerFilter: string | null;
  focus: PaneId;
  tab: MainTab;
  sidebarIndex: number;
  mainIndex: Record<MainTab, number>;
  inspectorIndex: number;
  filters: Record<MainTab, string>;
  filterEditing: boolean; // the `/` inline input owns the keyboard
  vaults: Record<string, VaultRuntime>;
  findings: Finding[] | null; // last check result (null: never ran)
  backups: string[];
  modals: Modal[];
  status: StatusMessage | null;
  busy: string | null; // label of the in-flight async action
}

export function initialState(registry: Registry): AppState {
  return {
    registry,
    activeVault: registry.defaults.vault,
    consumerFilter: null,
    focus: "main",
    tab: "variables",
    sidebarIndex: 1, // 0 is the VAULTS header; a valid registry always has a vault below it
    mainIndex: { variables: 0, globals: 0, groups: 0, compose: 0, backups: 0 },
    inspectorIndex: 0,
    filters: { variables: "", globals: "", groups: "", compose: "", backups: "" },
    filterEditing: false,
    vaults: {},
    findings: null,
    backups: [],
    modals: [],
    status: null,
    busy: null,
  };
}

export type Action =
  | { type: "registry"; registry: Registry }
  | { type: "focus"; pane: PaneId }
  | { type: "tab"; tab: MainTab }
  | { type: "sidebarIndex"; index: number }
  | { type: "mainIndex"; tab: MainTab; index: number }
  | { type: "inspectorIndex"; index: number }
  | { type: "filter"; tab: MainTab; value: string }
  | { type: "filterEditing"; editing: boolean }
  | { type: "activeVault"; vault: string }
  | { type: "consumerFilter"; consumer: string | null }
  | { type: "vaultRuntime"; vault: string; runtime: VaultRuntime }
  | { type: "vaultsReset"; vaults: Record<string, VaultRuntime> }
  | { type: "findings"; findings: Finding[] }
  | { type: "backups"; backups: string[] }
  | { type: "pushModal"; modal: Modal }
  | { type: "popModal" }
  | { type: "status"; status: StatusMessage | null }
  | { type: "busy"; busy: string | null };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "registry": {
      // Keep scope choices valid against the reloaded registry.
      const activeVault =
        action.registry.vaults[state.activeVault] !== undefined ? state.activeVault : action.registry.defaults.vault;
      const consumerFilter =
        state.consumerFilter !== null && action.registry.consumers[state.consumerFilter] !== undefined
          ? state.consumerFilter
          : null;
      return { ...state, registry: action.registry, activeVault, consumerFilter };
    }
    case "focus":
      return { ...state, focus: action.pane };
    case "tab":
      return { ...state, tab: action.tab };
    case "sidebarIndex":
      return { ...state, sidebarIndex: action.index };
    case "mainIndex":
      return { ...state, mainIndex: { ...state.mainIndex, [action.tab]: action.index }, inspectorIndex: 0 };
    case "inspectorIndex":
      return { ...state, inspectorIndex: action.index };
    case "filter":
      return {
        ...state,
        filters: { ...state.filters, [action.tab]: action.value },
        mainIndex: { ...state.mainIndex, [action.tab]: 0 },
      };
    case "filterEditing":
      return { ...state, filterEditing: action.editing };
    case "activeVault":
      return { ...state, activeVault: action.vault };
    case "consumerFilter":
      return { ...state, consumerFilter: action.consumer };
    case "vaultRuntime":
      return { ...state, vaults: { ...state.vaults, [action.vault]: action.runtime } };
    case "vaultsReset":
      return { ...state, vaults: action.vaults };
    case "findings":
      return { ...state, findings: action.findings };
    case "backups":
      return { ...state, backups: action.backups };
    case "pushModal":
      return { ...state, modals: [...state.modals, action.modal] };
    case "popModal":
      return { ...state, modals: state.modals.slice(0, -1) };
    case "status":
      return { ...state, status: action.status };
    case "busy":
      return { ...state, busy: action.busy };
  }
}

export interface Store {
  state: AppState;
  // getState and dispatch are referentially STABLE across renders — effects
  // can depend on them without re-running on every state change.
  getState: () => AppState;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({
  registry,
  children,
}: {
  registry: Registry;
  children: React.ReactNode;
}): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, registry, initialState);
  const ref = useRef(state);
  ref.current = state;
  const getState = useCallback(() => ref.current, []);
  const store = useMemo<Store>(() => ({ state, getState, dispatch }), [state, getState]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useStore outside StoreProvider");
  return store;
}
