// The tabbed main pane: Variables · Globals · Groups · Compose · Backups.
import { TextInput } from "@inkjs/ui";
import { Box, Text } from "ink";
import type React from "react";
import { ListRow, type Segment } from "../components/listRow.tsx";
import { Pane } from "../components/pane.tsx";
import { ScrollList } from "../components/scrollList.tsx";
import { backupsList, composeList, globalsList, groupsList, isSelectable, settleIndex, variablesList } from "../state/lists.ts";
import { cellGlyph, cellState, truncate, variableCount } from "../state/selectors.ts";
import type { AppState, MainTab, Store } from "../state/store.tsx";
import { MAIN_TABS } from "../state/store.tsx";
import { theme } from "../theme.ts";
import { HumanVariablesTab } from "./humanVariables.tsx";

// The tab strip. The active tab is a filled pill: half-block caps ▐…▌ wrap the
// label on an accent fill. The caps are real glyphs, so under NO_COLOR (which
// strips the fill and bold) the active tab stays bracketed and legible — same
// trick as the list selection ▌ bar.
function TabBar({ active }: { active: MainTab }): React.ReactElement {
  return (
    <Text>
      {MAIN_TABS.map((tab, i) => {
        const sep = i > 0 ? "  " : "";
        if (tab === active) {
          return (
            <Text key={tab}>
              {sep}
              <Text color={theme.accent}>▐</Text>
              <Text backgroundColor={theme.accent} color="black" bold>
                {` ${tab} `}
              </Text>
              <Text color={theme.accent}>▌</Text>
            </Text>
          );
        }
        return (
          <Text key={tab} color={theme.muted}>
            {sep}
            {tab}
          </Text>
        );
      })}
    </Text>
  );
}

function FilterLine({ store, count, total }: { store: Store; count: number; total: number }): React.ReactElement | null {
  const state = store.state;
  const filter = state.filters[state.tab];
  if (state.filterEditing) {
    return (
      <Box>
        <Text color={theme.accent}>/</Text>
        <TextInput
          defaultValue={filter}
          onChange={(value) => store.dispatch({ type: "filter", tab: state.tab, value })}
          onSubmit={() => store.dispatch({ type: "filterEditing", editing: false })}
        />
        <Text color={theme.muted}>
          {" "}
          ({count}/{total})
        </Text>
      </Box>
    );
  }
  if (filter !== "") {
    return (
      <Text color={theme.muted}>
        /{filter} ({count}/{total}) <Text color={theme.accent}>esc</Text> clears
      </Text>
    );
  }
  return null;
}

function VariablesTab({ state, height }: { state: AppState; height: number }): React.ReactElement {
  const rows = variablesList(state);
  const focused = state.focus === "main";
  if (rows.length === 0) {
    const anyDefined = Object.keys(state.registry.variables).length > 0;
    return (
      <Text color={theme.muted}>
        {anyDefined ? "no variables match — esc clears the filter" : "no variables yet — press n to define, i to import a .env"}
      </Text>
    );
  }
  const consumers = state.consumerFilter !== null ? [state.consumerFilter] : Object.keys(state.registry.consumers).sort();
  const values = state.vaults[state.activeVault]?.values ?? null;
  return (
    <ScrollList
      items={rows}
      selected={settleIndex(rows, state.mainIndex.variables, isSelectable)}
      height={height}
      renderItem={(row, _i, isSelected) => {
        if (row.type === "header") {
          return (
            <Text key={`g:${row.title}`} color={theme.muted} bold>
              ── {row.title} {"─".repeat(Math.max(0, 24 - row.title.length))}
            </Text>
          );
        }
        const segments: Segment[] = [
          { text: truncate(row.name, 28).padEnd(28), bold: isSelected },
          { text: row.def.secret === true ? " S" : "  ", color: theme.secret },
        ];
        for (const c of consumers) {
          const glyph = cellGlyph(cellState(row.def, state.activeVault, c, values));
          segments.push({ text: ` ${truncate(c, 10)}`, color: theme.muted, dim: true });
          segments.push({ text: glyph.char, color: glyph.color });
        }
        return <ListRow key={row.name} segments={segments} selected={isSelected} focused={focused} />;
      }}
    />
  );
}

function GlobalsTab({ state, height }: { state: AppState; height: number }): React.ReactElement {
  const names = globalsList(state);
  const focused = state.focus === "main";
  if (names.length === 0) {
    return <Text color={theme.muted}>no globals yet — press n to define one for vault "{state.activeVault}"</Text>;
  }
  return (
    <ScrollList
      items={names}
      selected={state.mainIndex.globals}
      height={height}
      renderItem={(name, _i, isSelected) => {
        const def = state.registry.globals[name];
        const v = def?.values[state.activeVault];
        const sourceText =
          v === undefined ? "— (not for this vault)" : v.source === "runtime" ? "runtime" : `static = ${truncate(v.value, 24)}`;
        const segments: Segment[] = [
          { text: truncate(name, 28).padEnd(30), bold: isSelected },
          {
            text: sourceText,
            color: v === undefined ? theme.muted : v.source === "runtime" ? theme.info : theme.success,
            dim: v === undefined,
          },
        ];
        if (def?.description !== undefined) segments.push({ text: ` · ${truncate(def.description, 30)}`, color: theme.muted, dim: true });
        return <ListRow key={name} segments={segments} selected={isSelected} focused={focused} />;
      }}
    />
  );
}

function GroupsTab({ state, height }: { state: AppState; height: number }): React.ReactElement {
  const keys = groupsList(state);
  const focused = state.focus === "main";
  if (keys.length === 0) return <Text color={theme.muted}>no groups yet — press n to add one</Text>;
  return (
    <ScrollList
      items={keys}
      selected={state.mainIndex.groups}
      height={height}
      renderItem={(key, _i, isSelected) => {
        const members = Object.values(state.registry.variables).filter((v) => v.groupKey === key).length;
        const segments: Segment[] = [
          { text: truncate(key, 20).padEnd(22), bold: isSelected },
          { text: truncate(state.registry.groups[key]?.title ?? "", 30).padEnd(32) },
          { text: `${members} variable(s)`, color: theme.muted, dim: true },
        ];
        return <ListRow key={key} segments={segments} selected={isSelected} focused={focused} />;
      }}
    />
  );
}

function ComposeTab({ state, height }: { state: AppState; height: number }): React.ReactElement {
  const files = composeList(state);
  const focused = state.focus === "main";
  if (files.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={theme.muted}>no compose files bound — press n to bind one</Text>
        <Text color={theme.muted}>markers are hand-authored: # &lt;menv:consumer&gt; … # &lt;/menv&gt; — menv only fills between them</Text>
      </Box>
    );
  }
  const findings = state.findings ?? [];
  return (
    <Box flexDirection="column">
      <ScrollList
        items={files}
        selected={state.mainIndex.compose}
        height={Math.max(1, height - 1)}
        renderItem={(file, _i, isSelected) => {
          const related = findings.filter((f) => f.message.startsWith(`${file}:`) || f.message.includes(` ${file}`));
          const worst = related.find((f) => f.severity === "error") ?? related[0];
          const segments: Segment[] = [{ text: truncate(file, 40).padEnd(42), bold: isSelected }];
          if (worst !== undefined) {
            segments.push({
              text: `${worst.severity === "error" ? "✖" : "⚠"} ${worst.code}`,
              color: worst.severity === "error" ? theme.error : theme.warning,
            });
          } else {
            segments.push({ text: "bound", color: theme.muted, dim: true });
          }
          return <ListRow key={file} segments={segments} selected={isSelected} focused={focused} />;
        }}
      />
      <Text color={theme.muted} wrap="truncate">
        markers are hand-authored; menv fills between # &lt;menv:consumer&gt; … # &lt;/menv&gt;
      </Text>
    </Box>
  );
}

function BackupsTab({ state, height }: { state: AppState; height: number }): React.ReactElement {
  const backups = backupsList(state);
  const focused = state.focus === "main";
  if (backups.length === 0) return <Text color={theme.muted}>no backups yet — press n to snapshot registry + vaults + outputs</Text>;
  return (
    <ScrollList
      items={backups}
      selected={state.mainIndex.backups}
      height={height}
      renderItem={(key, _i, isSelected) => (
        <ListRow
          key={key}
          segments={[
            { text: key, bold: isSelected },
            { text: ` .menv/backups/${key}/`, color: theme.muted, dim: true },
          ]}
          selected={isSelected}
          focused={focused}
        />
      )}
    />
  );
}

export function MainPane({
  store,
  height,
  width,
  narrow,
  roomy,
}: {
  store: Store;
  height: number;
  width: number;
  narrow: boolean;
  roomy: boolean;
}): React.ReactElement {
  const state = store.state;
  const focused = state.focus === "main";
  const counts: Record<MainTab, [number, number]> = {
    variables: [variableCount(variablesList(state)), Object.keys(state.registry.variables).length],
    globals: [globalsList(state).length, Object.keys(state.registry.globals).length],
    groups: [groupsList(state).length, Object.keys(state.registry.groups).length],
    compose: [composeList(state).length, state.registry.compose.files.length],
    backups: [backupsList(state).length, state.backups.length],
  };
  const [count, total] = counts[state.tab];
  const listHeight = Math.max(1, height - 3); // tab bar + filter line + legend slack
  const body = (() => {
    switch (state.tab) {
      case "variables":
        return state.humanMode ? (
          <HumanVariablesTab state={state} height={listHeight} width={width} />
        ) : (
          <VariablesTab state={state} height={listHeight} />
        );
      case "globals":
        return <GlobalsTab state={state} height={listHeight} />;
      case "groups":
        return <GroupsTab state={state} height={listHeight} />;
      case "compose":
        return <ComposeTab state={state} height={listHeight} />;
      case "backups":
        return <BackupsTab state={state} height={listHeight} />;
    }
  })();
  return (
    <Pane title={`[2] tabs${narrow ? " (⏎ for detail)" : ""}`} focused={focused} flexGrow={1} roomy={roomy}>
      <TabBar active={state.tab} />
      <FilterLine store={store} count={count} total={total} />
      {body}
    </Pane>
  );
}
