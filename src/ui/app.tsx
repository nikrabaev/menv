import React, { useState } from "react";
import { Box, Text, useApp, useInput, render } from "ink";
import type { RepoModel } from "../core/types.ts";
import type { Store } from "../store/store.ts";
import { useModel, useDirty } from "./useStore.ts";
import { TopBar } from "./components/TopBar.tsx";
import { ScopeTree, buildScopes } from "./components/ScopeTree.tsx";
import { VariableList } from "./components/VariableList.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { EditValueModal } from "./components/EditValueModal.tsx";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { loadRepo } from "../store/load.ts";
import { loadOrCreateIdentity } from "../crypto/identity.ts";

type Pane = "scopes" | "vars";
type Mode = "browse" | "edit";

function varsForScope(model: RepoModel, scopeId: string) {
  if (scopeId === "global") return model.variables.filter((v) => v.tier === "global");
  if (scopeId.startsWith("group:")) {
    const g = scopeId.slice("group:".length);
    return model.variables.filter((v) => v.group === g);
  }
  return model.variables.filter((v) => v.consumers.includes(scopeId));
}

export function MenvApp({ store, onSaveStamp }: { store: Store; onSaveStamp: () => string }) {
  const model = useModel(store);
  const dirty = useDirty(store);
  const { exit } = useApp();

  const scopes = buildScopes(model);
  const [pane, setPane] = useState<Pane>("vars");
  const [scopeCursor, setScopeCursor] = useState(0);
  const [varCursor, setVarCursor] = useState(0);
  const [env, setEnv] = useState(model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev");
  const [mode, setMode] = useState<Mode>("browse");
  const [status, setStatus] = useState("");

  const scope = scopes[scopeCursor];
  const variables = scope ? varsForScope(model, scope.id) : model.variables;
  const current = variables[varCursor] ?? null;

  useInput((input, key) => {
    if (mode === "edit") return;
    if (input === "q") {
      exit();
      return;
    }
    if (key.tab) {
      setPane((p) => (p === "scopes" ? "vars" : "scopes"));
      return;
    }
    if (key.upArrow) {
      if (pane === "scopes") setScopeCursor((c) => Math.max(0, c - 1));
      else setVarCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      if (pane === "scopes") setScopeCursor((c) => Math.min(scopes.length - 1, c + 1));
      else setVarCursor((c) => Math.min(variables.length - 1, c + 1));
      return;
    }
    if (input === "e") {
      const ids = model.environments.map((e) => e.id);
      setEnv((cur) => ids[(ids.indexOf(cur) + 1) % ids.length]);
      return;
    }
    if (input === "d" && current) {
      store.toggleSecret(current.id);
      return;
    }
    if (key.return && current && pane === "vars") {
      setMode("edit");
      return;
    }
    if (input === "s") {
      void saveModel(store.getModel(), onSaveStamp()).then((sum) => {
        store.markClean();
        setStatus(`saved ${sum.files.length} files`);
      });
    }
  });

  return (
    <Box flexDirection="column">
      <TopBar root={model.root} env={env} dirty={dirty} unsaved={dirty ? 1 : 0} />
      <Box>
        <ScopeTree scopes={scopes} cursor={pane === "scopes" ? scopeCursor : -1} />
        <VariableList variables={variables} cursor={pane === "vars" ? varCursor : -1} />
        <Inspector model={model} variable={current} env={env} />
      </Box>
      {mode === "edit" && current ? (
        <EditValueModal
          varName={current.name}
          env={env}
          initial={model.values[current.id]?.[env] ?? ""}
          onSubmit={(v) => { store.setValue(current.id, env, v); setMode("browse"); }}
          onCancel={() => setMode("browse")}
        />
      ) : (
        <Box paddingX={1}>
          <Text color="gray">up/down move / tab pane / enter edit / e env / d secret / s save / q quit  </Text>
          <Text color="green">{status}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function launchTui(root: string): Promise<void> {
  const kp = await loadOrCreateIdentity();
  const model = await loadRepo(root, kp.identity);
  const store = createStore(model);
  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  const { waitUntilExit } = render(<MenvApp store={store} onSaveStamp={stamp} />);
  await waitUntilExit();
}
