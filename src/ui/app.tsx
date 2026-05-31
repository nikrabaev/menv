import React, { useState } from "react";
import { Box, Text, useApp, useInput, useStdout, render } from "ink";
import type { Store } from "../store/store.ts";
import { useModel, useDirty } from "./useStore.ts";
import { useTerminalSize } from "./useTerminalSize.ts";
import { TopBar } from "./components/TopBar.tsx";
import { ScopeTree } from "./components/ScopeTree.tsx";
import { buildScopes, varsForScope, stepScope } from "./scopes.ts";
import { orderedVariables, groupStarts, jumpGroup, groupNames } from "./grouping.ts";
import { VariableList } from "./components/VariableList.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { EditFieldModal } from "./components/EditFieldModal.tsx";
import { NewVariableModal } from "./components/NewVariableModal.tsx";
import { GroupComboModal } from "./components/GroupComboModal.tsx";
import { WireModal } from "./components/WireModal.tsx";
import { TextInput } from "./components/TextInput.tsx";
import { inspectorFields, copyableText } from "./inspectorFields.ts";
import { type EditTarget, editLabel, editInitial, applyEdit } from "./editTarget.ts";
import { copyToClipboard } from "../io/clipboard.ts";
import { valueOf } from "../core/model.ts";
import { saveModel } from "../store/save.ts";
import { createStore } from "../store/store.ts";
import { loadRepo } from "../store/load.ts";
import { loadOrCreateIdentity } from "../crypto/identity.ts";

type Pane = "scopes" | "vars" | "inspector";
type Mode = "browse" | "edit" | "new" | "wire" | "filter";

export const ENTER_FULLSCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
export const EXIT_FULLSCREEN = "\x1b[?1049l";

function isInteractiveStdout(stdout: NodeJS.WriteStream): boolean {
  return stdout.isTTY === true;
}

export function enterFullscreen(stdout: NodeJS.WriteStream = process.stdout): void {
  if (isInteractiveStdout(stdout)) stdout.write(ENTER_FULLSCREEN);
}

export function exitFullscreen(stdout: NodeJS.WriteStream = process.stdout): void {
  if (isInteractiveStdout(stdout)) stdout.write(EXIT_FULLSCREEN);
}

const SEPARATOR = " · ";

// A single keycap chip, e.g. ` tab `, matching the prior inline styling.
const Key = ({ children }: { children: React.ReactNode }) => (
  <Text bold backgroundColor="blackBright"> {children} </Text>
);

export function MenvApp({ store, onSaveStamp, copy = copyToClipboard, viewportRows, viewportColumns }: {
  store: Store;
  onSaveStamp: () => string;
  copy?: (text: string) => Promise<boolean>;
  viewportRows?: number;
  viewportColumns?: number;
}) {
  const model = useModel(store);
  const dirty = useDirty(store);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const term = useTerminalSize(stdout);
  const rows = viewportRows ?? term.rows ?? 24;
  const columns = viewportColumns ?? term.columns ?? 100;

  const scopes = buildScopes(model);
  const [pane, setPane] = useState<Pane>("vars");
  const [scopeCursor, setScopeCursor] = useState(0);
  const [varCursor, setVarCursor] = useState(0);
  const [inspectorCursor, setInspectorCursor] = useState(0);
  const [env, setEnv] = useState(model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev");
  const [mode, setMode] = useState<Mode>("browse");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");

  // Group editing uses the combobox, whose suggestion block (and thus height) is
  // sized to the number of existing groups, capped.
  const GROUP_SUGGEST_CAP = 6;
  const allGroups = groupNames(model.variables);
  const groupSuggestRows = Math.min(GROUP_SUGGEST_CAP, allGroups.length);
  const groupEditing = mode === "edit" && editTarget?.kind === "group";

  // The layout is exact: topBar(3) + paneHeight + bottomHeight = rows, so bottomHeight
  // must equal the bottom region's *actual* rendered height. (Wire mode is the
  // exception: it hides the panes and covers the full area below the top bar.)
  const bottomHeight =
    mode === "browse" ? 1 // status line
    : mode === "filter" ? 3 // border(2) + input(1)
    : groupEditing ? groupSuggestRows + 5 // border(2) + title + field + suggestions + hint
    : mode === "edit" || mode === "new" ? 5 // border(2) + title + field + hint
    : 1;
  const paneHeight = Math.max(3, rows - 3 - bottomHeight);

  const scope = scopes[scopeCursor];
  const inScope = scope ? varsForScope(model, scope.id) : model.variables;
  const matched = filter
    ? inScope.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase()))
    : inScope;
  // Group the list whenever the visible set carries at least one group; otherwise
  // it's a flat, name-sorted list. `ordered` is the display order the cursor indexes
  // into (ungrouped first, then groups), and matches VariableList's own layout.
  // A group scope is already a single group, so its header would be redundant.
  const grouped = scope?.kind !== "group" && matched.some((v) => v.group !== null);
  const filtered = orderedVariables(matched, grouped);
  const groupStartIdx = groupStarts(matched, grouped);
  const current = filtered[varCursor] ?? null;
  const fields = current ? inspectorFields(model, current, env) : [];
  // Clamp so the rendered/acted-on field stays in range as the variable changes.
  const inspCursor = Math.min(inspectorCursor, Math.max(0, fields.length - 1));

  useInput((input, key) => {
    // Text-entry modes (filter/edit/new) route keys to their own TextInput; the
    // global keymap below is browse-only.
    if (mode !== "browse") return;
    if (input === "q") {
      exit();
      return;
    }
    if (key.tab) {
      setPane((p) => (p === "scopes" ? "vars" : p === "vars" ? (current ? "inspector" : "scopes") : "scopes"));
      return;
    }
    if (key.escape && pane === "inspector") {
      setPane("vars");
      return;
    }
    // Shift/Option + ↑/↓ jump between group buckets in the variable list. macOS
    // reserves Ctrl+↑/↓ (Mission Control) and never forwards Cmd to the terminal,
    // so we use Shift (sent by most terminals) and Option/Meta (when mapped).
    if (grouped && pane === "vars" && (key.shift || key.meta) && (key.upArrow || key.downArrow)) {
      const next = jumpGroup(groupStartIdx, varCursor, key.downArrow ? 1 : -1);
      if (next !== varCursor) { setVarCursor(next); setInspectorCursor(0); }
      return;
    }
    if (key.upArrow) {
      if (pane === "scopes") {
        const next = stepScope(scopes, scopeCursor, -1);
        setScopeCursor(next);
        if (next !== scopeCursor) { setVarCursor(0); setInspectorCursor(0); }
      } else if (pane === "vars") {
        setVarCursor((c) => Math.max(0, c - 1));
        setInspectorCursor(0);
      } else {
        setInspectorCursor((c) => Math.max(0, c - 1));
      }
      return;
    }
    if (key.downArrow) {
      if (pane === "scopes") {
        const next = stepScope(scopes, scopeCursor, 1);
        setScopeCursor(next);
        if (next !== scopeCursor) { setVarCursor(0); setInspectorCursor(0); }
      } else if (pane === "vars") {
        setVarCursor((c) => Math.min(filtered.length - 1, c + 1));
        setInspectorCursor(0);
      } else {
        setInspectorCursor((c) => Math.min(fields.length - 1, c + 1));
      }
      return;
    }
    if (input === "e") {
      const ids = model.environments.map((e) => e.id);
      setEnv((cur) => ids[(ids.indexOf(cur) + 1) % ids.length]);
      return;
    }
    if (input === "c" && current) {
      const field = pane === "inspector" ? fields[inspCursor] : undefined;
      const text = field ? copyableText(field) : valueOf(model, current.id, env);
      const label = field ? (field.kind === "value" ? `(${field.env})` : field.label) : `(${env})`;
      if (!text) {
        // null = a non-text field (secret/wiring); "" = an unset value/empty field.
        setStatus("nothing to copy");
        return;
      }
      const name = current.name;
      void copy(text).then((ok) => setStatus(ok ? `copied ${name} ${label}` : "clipboard unavailable"));
      return;
    }
    if (key.return && current) {
      if (pane === "inspector") {
        const f = fields[inspCursor];
        if (!f) return;
        if (f.kind === "secret") { store.toggleSecret(current.id); return; }
        if (f.kind === "wiring") { setMode("wire"); return; }
        setEditTarget(f.kind === "value" ? { kind: "value", env: f.env } : { kind: f.kind });
        setMode("edit");
        return;
      }
      if (pane === "vars") {
        setEditTarget({ kind: "value", env });
        setMode("edit");
        return;
      }
    }
    if (input === "/") {
      setMode("filter");
      return;
    }
    if (input === "n") {
      setMode("new");
      return;
    }
    if (input === "x" && current) {
      store.deleteVariable(current.id);
      setVarCursor((c) => Math.max(0, Math.min(c, filtered.length - 2)));
      setInspectorCursor(0);
      if (pane === "inspector") setPane("vars");
      return;
    }
    if (input === "s") {
      void saveModel(store.getModel(), env, onSaveStamp()).then((sum) => {
        store.markClean();
        setStatus(`saved ${sum.files.length} files`);
      });
    }
  });

  if (mode === "wire" && current) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <TopBar root={model.root} env={env} environments={model.environments.map((e) => e.id)} dirty={dirty} unsaved={dirty ? 1 : 0} />
        <WireModal
          varName={current.name}
          consumers={model.consumers}
          wired={current.consumers}
          onToggle={(id) => store.wire(current.id, id, !current.consumers.includes(id))}
          onClose={() => setMode("browse")}
          height={Math.max(3, rows - 3)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <TopBar root={model.root} env={env} environments={model.environments.map((e) => e.id)} dirty={dirty} unsaved={dirty ? 1 : 0} />
      <Box height={paneHeight}>
        <ScopeTree scopes={scopes} cursor={scopeCursor} active={pane === "scopes"} height={paneHeight} />
        <VariableList variables={filtered} cursor={varCursor} height={paneHeight} scopeLabel={scope?.label} consumers={model.consumers} showScopes={scope?.kind === "all" || scope?.kind === "global"} filter={filter} model={model} env={env} grouped={grouped} />
        <Inspector model={model} variable={current} env={env} active={pane === "inspector"} cursor={inspCursor} height={paneHeight} />
      </Box>
      {mode === "edit" && current && editTarget ? (
        editTarget.kind === "group" ? (
          <GroupComboModal
            initial={editInitial(model, current, editTarget)}
            groups={allGroups}
            suggestionRows={groupSuggestRows}
            width={columns}
            onSubmit={(v) => { applyEdit(store, current.id, editTarget, v); setMode("browse"); setEditTarget(null); }}
            onCancel={() => { setMode("browse"); setEditTarget(null); }}
          />
        ) : (
          <EditFieldModal
            label={editLabel(editTarget)}
            initial={editInitial(model, current, editTarget)}
            width={columns}
            onSubmit={(v) => { applyEdit(store, current.id, editTarget, v); setMode("browse"); setEditTarget(null); }}
            onCancel={() => { setMode("browse"); setEditTarget(null); }}
          />
        )
      ) : mode === "filter" ? (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} width={columns}>
          <Text>/ </Text>
          <TextInput
            value={filter}
            width={columns - 6} // border(2) + paddingX(2) + the "/ " prefix(2)
            onChange={(v) => { setFilter(v); setVarCursor(0); }}
            onSubmit={() => setMode("browse")}
            onCancel={() => setMode("browse")}
          />
        </Box>
      ) : mode === "new" ? (
        <NewVariableModal
          width={columns}
          onSubmit={(name) => {
            const tier = scope?.kind === "app" ? "local" : "global";
            const ownerApp = tier === "local" ? scope!.id : undefined;
            store.addVariable({ id: `var:${name}`, name, tier, ownerApp, description: "", group: null, secret: false, consumers: ownerApp ? [ownerApp] : [] });
            setMode("browse");
          }}
          onCancel={() => setMode("browse")}
        />
      ) : (
        <Box paddingX={1} justifyContent="space-between">
          {/* The hints sit in a shrinkable box and truncate (never wrap): the footer
              must stay one row or it breaks the topBar(3)+paneHeight+bottomHeight(1)
              budget and overlaps the panes. The status keeps its width, so feedback
              stays visible even on a narrow terminal where the hints get clipped. */}
          <Box flexShrink={1} marginRight={1}>
            {pane === "inspector" && current ? (
              <Text color="gray" wrap="truncate-end">
                <Key>↑↓</Key> field{SEPARATOR}<Key>⏎</Key> edit{SEPARATOR}<Key>c</Key> copy{SEPARATOR}<Key>esc</Key> back{SEPARATOR}<Key>tab</Key> pane{SEPARATOR}<Key>e</Key> env{SEPARATOR}<Key>s</Key> save{SEPARATOR}<Key>q</Key> quit
              </Text>
            ) : (
              <Text color="gray" wrap="truncate-end">
                <Key>↑↓</Key> move{grouped && pane === "vars" ? <>{SEPARATOR}<Key>⇧↑↓</Key> group</> : null}{SEPARATOR}<Key>tab</Key> pane{SEPARATOR}<Key>⏎</Key> edit{SEPARATOR}<Key>c</Key> copy{SEPARATOR}<Key>/</Key> filter{SEPARATOR}<Key>n</Key> new{SEPARATOR}<Key>x</Key> delete{SEPARATOR}<Key>e</Key> env{SEPARATOR}<Key>s</Key> save{SEPARATOR}<Key>q</Key> quit
              </Text>
            )}
          </Box>
          <Box flexShrink={0}>
            <Text color="green">{status}</Text>
          </Box>
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
  let instance: ReturnType<typeof render> | undefined;
  enterFullscreen();
  try {
    instance = render(<MenvApp store={store} onSaveStamp={stamp} />);
    await instance.waitUntilExit();
  } finally {
    instance?.unmount();
    instance?.cleanup();
    exitFullscreen();
  }
}
