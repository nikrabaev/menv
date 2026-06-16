// The central key router for the pane layer (modals own their input). Pane
// verbs match keys.ts — the footer and help render from the same table.
import type { Key } from "ink";
import type { TuiContext } from "./state/data.ts";
import { loadAllVaults, loadBackupList, loadFindings, reloadRegistry } from "./state/data.ts";
import { runCheckAction } from "./state/generate.ts";
import {
  isSelectable,
  mainListLength,
  moveSelectable,
  selectedMainId,
  selectedSidebarEntry,
  selectedVariable,
  settleIndex,
  sidebarEntries,
  variablesList,
} from "./state/lists.ts";
import {
  backupNow,
  composeUnbind,
  ensureUnlocked,
  groupRemove,
  runAction,
  setStatus,
  startComposeBind,
  startConsumerAdd,
  startConsumerEdit,
  startConsumerRemove,
  startGlobalForm,
  startGlobalRemove,
  startGroupAdd,
  startGroupEdit,
  startImport,
  startRestore,
  startReveal,
  startSetValue,
  startUnwire,
  startValueEdit,
  startVarDefine,
  startVarEdit,
  startVarRemove,
  startVaultAdd,
  startVaultEdit,
  startWire,
  toggleDisabled,
  toggleReveal,
  vaultRemove,
  vaultSetDefault,
} from "./state/mutations.ts";
import { humanVarRows, wiringRows } from "./state/selectors.ts";
import type { MainTab, PaneId, Store } from "./state/store.tsx";
import { MAIN_TABS } from "./state/store.tsx";

const FILTERABLE: Record<MainTab, boolean> = { variables: true, globals: true, groups: true, compose: true, backups: true };

function reloadAll(store: Store, ctx: TuiContext): void {
  void runAction(store, "reload", async () => {
    const registry = await reloadRegistry(ctx);
    store.dispatch({ type: "registry", registry });
    store.dispatch({ type: "vaultsReset", vaults: await loadAllVaults(ctx, registry) });
    store.dispatch({ type: "backups", backups: await loadBackupList(ctx) });
    store.dispatch({ type: "findings", findings: await loadFindings(ctx, registry) });
    setStatus(store, "success", "reloaded from disk");
  });
}

function moveMain(store: Store, delta: number): void {
  const state = store.getState();
  if (state.tab === "variables") {
    const rows = variablesList(state);
    const settled = settleIndex(rows, state.mainIndex.variables, isSelectable);
    store.dispatch({ type: "mainIndex", tab: state.tab, index: moveSelectable(rows, settled, delta, isSelectable) });
    return;
  }
  const length = mainListLength(state);
  const current = state.mainIndex[state.tab];
  store.dispatch({ type: "mainIndex", tab: state.tab, index: Math.min(Math.max(0, length - 1), Math.max(0, current + delta)) });
}

function handleSidebarKey(store: Store, ctx: TuiContext, input: string, key: Key): void {
  const state = store.getState();
  const entries = sidebarEntries(state.registry);
  if (key.upArrow || input === "k") {
    store.dispatch({ type: "sidebarIndex", index: moveSelectable(entries, state.sidebarIndex, -1, isSelectable) });
    return;
  }
  if (key.downArrow || input === "j") {
    store.dispatch({ type: "sidebarIndex", index: moveSelectable(entries, state.sidebarIndex, 1, isSelectable) });
    return;
  }
  const entry = selectedSidebarEntry(state);
  if (entry?.kind === "vault") {
    if (key.return) store.dispatch({ type: "activeVault", vault: entry.name });
    else if (input === "u") {
      const rt = state.vaults[entry.name];
      if (rt?.unlocked === true) setStatus(store, "info", `vault "${entry.name}" is already unlocked`);
      else ensureUnlocked(store, ctx, entry.name, () => setStatus(store, "success", `vault "${entry.name}" unlocked`));
    } else if (input === "a") startVaultAdd(store, ctx);
    else if (input === "e") startVaultEdit(store, ctx, entry.name);
    else if (input === "D") vaultSetDefault(store, ctx, entry.name);
    else if (input === "x") vaultRemove(store, ctx, entry.name);
  } else if (entry?.kind === "consumer") {
    if (key.return)
      store.dispatch({ type: "consumerFilter", consumer: state.consumerFilter === entry.name ? null : entry.name });
    else if (input === "a") startConsumerAdd(store, ctx);
    else if (input === "e") startConsumerEdit(store, ctx, entry.name);
    else if (input === "x") startConsumerRemove(store, ctx, entry.name);
  } else if (input === "a") {
    // "none — press a" placeholder row
    startConsumerAdd(store, ctx);
  }
}

// Human mode: navigating the selected card's consumer/value table. ⏎ on a row
// opens the value editor; esc returns to card navigation.
function handleHumanRowKey(store: Store, ctx: TuiContext, input: string, key: Key): void {
  const state = store.getState();
  if (key.escape) {
    store.dispatch({ type: "humanRowFocus", focused: false });
    return;
  }
  const name = selectedVariable(state);
  const def = name !== undefined ? state.registry.variables[name] : undefined;
  if (name === undefined || def === undefined) return;
  const values = state.vaults[state.activeVault]?.values ?? null;
  const rows = humanVarRows(def, state.activeVault, values);
  if (rows.length === 0) return;
  if (key.upArrow || input === "k") {
    store.dispatch({ type: "humanRowIndex", index: Math.max(0, state.humanRowIndex - 1) });
  } else if (key.downArrow || input === "j") {
    store.dispatch({ type: "humanRowIndex", index: Math.min(rows.length - 1, state.humanRowIndex + 1) });
  } else if (key.return) {
    const row = rows[Math.min(state.humanRowIndex, rows.length - 1)];
    if (row !== undefined) startValueEdit(store, ctx, name, state.activeVault, row.consumer);
  }
}

function handleMainKey(store: Store, ctx: TuiContext, narrow: boolean, input: string, key: Key): void {
  const state = store.getState();
  if (state.humanMode && state.tab === "variables" && state.humanRowFocus) {
    handleHumanRowKey(store, ctx, input, key);
    return;
  }
  if (key.upArrow || input === "k") {
    moveMain(store, -1);
    return;
  }
  if (key.downArrow || input === "j") {
    moveMain(store, 1);
    return;
  }
  if (key.pageUp) {
    moveMain(store, -10);
    return;
  }
  if (key.pageDown) {
    moveMain(store, 10);
    return;
  }
  const id = selectedMainId(state);
  switch (state.tab) {
    case "variables": {
      const name = selectedVariable(state);
      if (input === "n") {
        startVarDefine(store, ctx);
        return;
      }
      if (input === "i") {
        startImport(store, ctx);
        return;
      }
      if (name === undefined) return;
      const consumer = state.consumerFilter ?? undefined;
      if (key.return) {
        if (state.humanMode) {
          const def = state.registry.variables[name];
          const values = state.vaults[state.activeVault]?.values ?? null;
          const rows = def !== undefined ? humanVarRows(def, state.activeVault, values) : [];
          if (rows.length > 0) store.dispatch({ type: "humanRowFocus", focused: true });
          else setStatus(store, "info", `"${name}" is not wired in vault "${state.activeVault}" — press w to wire`);
        } else if (narrow) store.dispatch({ type: "pushModal", modal: { kind: "detail" } });
        else store.dispatch({ type: "focus", pane: "inspector" });
      } else if (input === "e") startVarEdit(store, ctx, name);
      else if (input === "x") startVarRemove(store, ctx, name);
      else if (input === "w") startWire(store, ctx, name);
      else if (input === "u") startUnwire(store, ctx, name, state.activeVault, consumer);
      else if (input === "s") startSetValue(store, ctx, name, state.activeVault, consumer);
      else if (input === "r") {
        if (state.revealSecrets) setStatus(store, "info", "secrets already revealed — ^r to hide");
        else startReveal(store, ctx, name, state.activeVault, consumer);
      } else if (input === "d") toggleDisabled(store, ctx, name, state.activeVault, consumer);
      return;
    }
    case "globals": {
      if (input === "n") startGlobalForm(store, ctx, "define");
      else if (id === undefined) return;
      else if (input === "e") {
        const def = state.registry.globals[id];
        if (def?.values[state.activeVault] === undefined) startGlobalForm(store, ctx, "define", id);
        else startGlobalForm(store, ctx, "update", id);
      } else if (input === "x") startGlobalRemove(store, ctx, id);
      else if (key.return && narrow) store.dispatch({ type: "pushModal", modal: { kind: "detail" } });
      return;
    }
    case "groups": {
      if (input === "n") startGroupAdd(store, ctx);
      else if (id === undefined) return;
      else if (input === "e") startGroupEdit(store, ctx, id);
      else if (input === "x") groupRemove(store, ctx, id);
      return;
    }
    case "compose": {
      if (input === "n") startComposeBind(store, ctx);
      else if (id !== undefined && input === "x") composeUnbind(store, ctx, id);
      return;
    }
    case "backups": {
      if (input === "n") backupNow(store, ctx);
      else if (id !== undefined && key.return) startRestore(store, ctx, id);
      return;
    }
  }
}

function handleInspectorKey(store: Store, ctx: TuiContext, input: string, key: Key): void {
  const state = store.getState();
  const name = selectedVariable(state);
  if (state.tab !== "variables" || name === undefined) {
    if (key.escape) store.dispatch({ type: "focus", pane: "main" });
    return;
  }
  const def = state.registry.variables[name];
  if (def === undefined) return;
  const rows = wiringRows(
    def,
    Object.fromEntries(Object.entries(state.vaults).map(([v, rt]) => [v, rt.values])),
  );
  const row = rows[state.inspectorIndex];
  if (key.upArrow || input === "k") store.dispatch({ type: "inspectorIndex", index: Math.max(0, state.inspectorIndex - 1) });
  else if (key.downArrow || input === "j")
    store.dispatch({ type: "inspectorIndex", index: Math.min(Math.max(0, rows.length - 1), state.inspectorIndex + 1) });
  else if (key.escape) store.dispatch({ type: "focus", pane: "main" });
  else if (input === "w") startWire(store, ctx, name);
  else if (row !== undefined) {
    if (input === "s") startSetValue(store, ctx, name, row.vault, row.consumer);
    else if (input === "r") {
      if (state.revealSecrets) setStatus(store, "info", "secrets already revealed — ^r to hide");
      else startReveal(store, ctx, name, row.vault, row.consumer);
    } else if (input === "d") toggleDisabled(store, ctx, name, row.vault, row.consumer);
    else if (input === "u") startUnwire(store, ctx, name, row.vault, row.consumer);
  }
}

const PANE_ORDER: PaneId[] = ["sidebar", "main", "inspector"];

export function handlePaneKey(store: Store, ctx: TuiContext, narrow: boolean, input: string, key: Key): void {
  const state = store.getState();

  // global chords first
  if (key.ctrl && input === "r") {
    toggleReveal(store);
    return;
  }
  if (input === "q") {
    store.dispatch({ type: "pushModal", modal: { kind: "quit" } });
    return;
  }
  if (input === "?") {
    store.dispatch({ type: "pushModal", modal: { kind: "help" } });
    return;
  }
  if (input === "c") {
    runCheckAction(store, ctx);
    return;
  }
  if (input === "g") {
    ensureUnlocked(store, ctx, state.activeVault, () =>
      store.dispatch({ type: "pushModal", modal: { kind: "generate" } }),
    );
    return;
  }
  if (input === "R") {
    reloadAll(store, ctx);
    return;
  }
  if (input === "H") {
    store.dispatch({ type: "humanMode", enabled: !state.humanMode });
    return;
  }
  if (input === "i" && state.tab !== "variables") {
    startImport(store, ctx);
    return;
  }
  if (input === "/" && state.focus === "main" && FILTERABLE[state.tab]) {
    store.dispatch({ type: "filterEditing", editing: true });
    return;
  }
  // esc backs out the most specific state first: when a human-mode var is
  // entered (its table is focused), the first esc exits the var (handled below
  // in handleHumanRowKey) and only a later esc clears the filter.
  const insideEnteredVar = state.humanMode && state.tab === "variables" && state.humanRowFocus;
  if (key.escape && state.focus === "main" && state.filters[state.tab] !== "" && !insideEnteredVar) {
    store.dispatch({ type: "filter", tab: state.tab, value: "" });
    return;
  }
  if (input === "[" || input === "]") {
    const at = MAIN_TABS.indexOf(state.tab);
    const next = MAIN_TABS[(at + (input === "]" ? 1 : MAIN_TABS.length - 1)) % MAIN_TABS.length] as MainTab;
    store.dispatch({ type: "tab", tab: next });
    store.dispatch({ type: "focus", pane: "main" });
    return;
  }
  if (input === "1") {
    store.dispatch({ type: "focus", pane: "sidebar" });
    return;
  }
  if (input === "2") {
    store.dispatch({ type: "focus", pane: "main" });
    return;
  }
  const hideInspector = narrow || state.humanMode;
  if (input === "3" && !hideInspector) {
    store.dispatch({ type: "focus", pane: "inspector" });
    return;
  }
  if (key.tab) {
    const order = hideInspector ? PANE_ORDER.slice(0, 2) : PANE_ORDER;
    const at = order.indexOf(state.focus);
    const next = order[(at + (key.shift ? order.length - 1 : 1)) % order.length] as PaneId;
    store.dispatch({ type: "focus", pane: next });
    return;
  }
  switch (state.focus) {
    case "sidebar":
      handleSidebarKey(store, ctx, input, key);
      return;
    case "main":
      handleMainKey(store, ctx, narrow, input, key);
      return;
    case "inspector":
      handleInspectorKey(store, ctx, input, key);
      return;
  }
}
