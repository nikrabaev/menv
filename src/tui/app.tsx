// The root component: size guard, init-wizard routing, chrome + panes + modal
// host, the pane-layer key router, and the startup data load.

import { basename } from "node:path";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { loadRegistry } from "../registry/persist.ts";
import type { Registry } from "../registry/types.ts";
import { Footer, Header, StatusBar } from "./components/chrome.tsx";
import { MIN_COLUMNS, MIN_ROWS, useScreenSize } from "./components/screen.ts";
import { handlePaneKey } from "./input.ts";
import type { KeyContext } from "./keys.ts";
import { ModalHost } from "./modals/host.tsx";
import type { TuiContext } from "./state/data.ts";
import { loadAllVaults, loadBackupList, loadFindings } from "./state/data.ts";
import { selectedSidebarEntry } from "./state/lists.ts";
import { StoreProvider, useStore } from "./state/store.tsx";
import { theme } from "./theme.ts";
import { InitWizard } from "./views/initWizard.tsx";
import { Inspector } from "./views/inspector.tsx";
import { MainPane } from "./views/mainPane.tsx";
import { Sidebar } from "./views/sidebar.tsx";

function keyContext(stateFocus: string, tab: string, sidebarKind: string | undefined, modalOpen: boolean): KeyContext {
  if (modalOpen) return "modal";
  if (stateFocus === "sidebar") return sidebarKind === "consumer" ? "sidebar-consumer" : "sidebar-vault";
  if (stateFocus === "inspector") return "inspector";
  return tab as KeyContext;
}

function AppBody({ ctx }: { ctx: TuiContext }): React.ReactElement {
  const store = useStore();
  const { state } = store;
  const { columns, rows } = useScreenSize();
  const narrow = columns < 110;

  // Startup load: vault snapshots, backups, and a background check — without
  // ever prompting for a passphrase (locked vaults degrade gracefully).
  // Depends only on the store's STABLE handles, so it runs exactly once.
  const { getState, dispatch } = store;
  useEffect(() => {
    let alive = true;
    void (async () => {
      const registry = getState().registry;
      const vaults = await loadAllVaults(ctx, registry);
      if (!alive) return;
      dispatch({ type: "vaultsReset", vaults });
      dispatch({ type: "backups", backups: await loadBackupList(ctx) });
      const findings = await loadFindings(ctx, registry);
      if (!alive) return;
      dispatch({ type: "findings", findings });
    })();
    return () => {
      alive = false;
    };
  }, [ctx, getState, dispatch]);

  const modalOpen = state.modals.length > 0;
  useInput((input, key) => handlePaneKey(store, ctx, narrow, input, key), {
    isActive: !modalOpen && !state.filterEditing,
  });

  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return (
      <Box padding={1}>
        <Text color={theme.warning}>
          terminal too small — menv tui needs at least {MIN_COLUMNS}×{MIN_ROWS} (now {columns}×{rows})
        </Text>
      </Box>
    );
  }

  const paneHeight = rows - 5; // header + status + footer + main pane border
  const listHeight = paneHeight - 4;
  const sidebarWidth = 36;
  const inspectorWidth = columns >= 130 ? 44 : 36;
  const roomy = rows >= 24; // breathing room above the floor; dropped at 80×20
  const entry = selectedSidebarEntry(state);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header state={state} repoName={basename(ctx.root)} />
      {modalOpen ? (
        <Box flexGrow={1}>
          <ModalHost store={store} ctx={ctx} />
        </Box>
      ) : (
        <Box flexGrow={1}>
          <Sidebar state={state} height={listHeight} width={sidebarWidth} roomy={roomy} />
          <MainPane store={store} height={paneHeight - 2} narrow={narrow} roomy={roomy} />
          {narrow ? null : <Inspector state={state} width={inspectorWidth} roomy={roomy} />}
        </Box>
      )}
      <StatusBar state={state} />
      <Footer context={keyContext(state.focus, state.tab, entry?.kind, modalOpen)} />
    </Box>
  );
}

export function App({ ctx, registry }: { ctx: TuiContext; registry: Registry | null }): React.ReactElement {
  const [loaded, setLoaded] = useState<Registry | null>(registry);
  if (loaded === null) {
    return (
      <InitWizard
        root={ctx.root}
        onDone={() => {
          void loadRegistry(ctx.root).then(setLoaded);
        }}
      />
    );
  }
  return (
    <StoreProvider registry={loaded}>
      <AppBody ctx={ctx} />
    </StoreProvider>
  );
}
