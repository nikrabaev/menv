// The inspector: full detail of the current selection. For a variable this is
// the heart of the tool — the complete wiring matrix (vault × consumer → key)
// with masked values. Reused as the detail modal on narrow terminals.
import { Box, Text } from "ink";
import type React from "react";
import { consumerPaths } from "../../generate/paths.ts";
import { Pane } from "../components/pane.tsx";
import { selectedMainId, selectedSidebarEntry } from "../state/lists.ts";
import { cellGlyph, maskValue, truncate, wiringRows } from "../state/selectors.ts";
import type { AppState } from "../state/store.tsx";
import { theme } from "../theme.ts";

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Text wrap="truncate">
      <Text color={theme.muted}>{label.padEnd(12)}</Text>
      {children}
    </Text>
  );
}

function VaultDetail({ state, name }: { state: AppState; name: string }): React.ReactElement {
  const def = state.registry.vaults[name];
  const rt = state.vaults[name];
  if (def === undefined) return <Text color={theme.muted}>vault removed</Text>;
  const cfg = def.vaultConfig as { filename?: string; encryption?: boolean };
  const mapped = Object.values(state.registry.variables).filter((v) => v.vaultMapping[name] !== undefined).length;
  return (
    <Box flexDirection="column">
      <Text bold>{name}</Text>
      <Row label="type">{def.vaultType}</Row>
      <Row label="file">{cfg.filename ?? "?"}</Row>
      <Row label="encryption">
        {cfg.encryption === false ? (
          <Text color={theme.warning}>plaintext — must stay git-ignored</Text>
        ) : (
          <Text color={theme.success}>encrypted (committable)</Text>
        )}
      </Row>
      <Row label="state">
        {rt === undefined ? "…" : rt.unlocked ? <Text color={theme.success}>unlocked</Text> : <Text color={theme.error}>locked — u to unlock</Text>}
      </Row>
      <Row label="default">{state.registry.defaults.vault === name ? "yes" : "no (D to set)"}</Row>
      <Row label="mapped vars">{String(mapped)}</Row>
    </Box>
  );
}

function ConsumerDetail({ state, name }: { state: AppState; name: string }): React.ReactElement {
  const def = state.registry.consumers[name];
  if (def === undefined) return <Text color={theme.muted}>consumer removed</Text>;
  const paths = consumerPaths(def);
  const wired = Object.values(state.registry.variables).filter((v) =>
    Object.values(v.vaultMapping).some((m) => m[name] !== undefined),
  ).length;
  return (
    <Box flexDirection="column">
      <Text bold>{name}</Text>
      <Row label="strategy">{def.strategyType}</Row>
      <Row label="baseDir">{def.strategyConfig.baseDir}</Row>
      {def.strategyType === "single" ? (
        <Row label="filename">{def.strategyConfig.filename}</Row>
      ) : (
        <Row label="filenames">
          {Object.entries(def.strategyConfig.filenames)
            .map(([v, f]) => `${v}=${f}`)
            .join(", ")}
        </Row>
      )}
      <Row label="secrets">
        {def.strategyConfig.secretsAsLocalOverrides === true ? "→ .local override file" : "inline"}
      </Row>
      <Row label="example">{def.strategyConfig.example === true ? ".env.example emitted" : "no"}</Row>
      <Row label="outputs">{[...paths.main, ...paths.local].join(", ")}</Row>
      <Row label="wired vars">{String(wired)}</Row>
    </Box>
  );
}

export function VariableDetail({
  state,
  name,
  wiringSelected,
  showWiringCursor,
}: {
  state: AppState;
  name: string;
  wiringSelected: number;
  showWiringCursor: boolean;
}): React.ReactElement {
  const def = state.registry.variables[name];
  if (def === undefined) return <Text color={theme.muted}>variable removed</Text>;
  const valuesByVault = Object.fromEntries(Object.entries(state.vaults).map(([v, rt]) => [v, rt.values]));
  const rows = wiringRows(def, valuesByVault);
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">
        {name} {def.secret === true ? <Text color={theme.secret}>S secret</Text> : null}
      </Text>
      {def.groupKey !== undefined ? <Row label="group">{state.registry.groups[def.groupKey]?.title ?? def.groupKey}</Row> : null}
      {def.description !== undefined ? <Row label="description">{def.description}</Row> : null}
      {def.example !== undefined ? <Row label="example">{def.example}</Row> : null}
      <Box marginTop={1}>
        <Text color={theme.muted} bold>
          WIRING (vault / consumer / value)
        </Text>
      </Box>
      {rows.length === 0 ? (
        <Text color={theme.muted}>unwired — press w to wire it (vault {state.activeVault})</Text>
      ) : (
        rows.map((row, i) => {
          const glyph = cellGlyph(row.cell);
          const rt = state.vaults[row.vault];
          const valueText =
            rt === undefined || !rt.unlocked
              ? "locked"
              : maskValue(def.secret === true, row.cell.key !== undefined ? rt.values?.[row.cell.key] : undefined);
          const isSelected = showWiringCursor && i === wiringSelected;
          return (
            <Text key={`${row.vault}/${row.consumer}`} inverse={isSelected} wrap="truncate">
              <Text color={glyph.color}>{glyph.char} </Text>
              <Text bold={row.vault === state.activeVault}>{truncate(row.vault, 10).padEnd(11)}</Text>
              <Text>{truncate(row.consumer, 10).padEnd(11)}</Text>
              <Text color={row.cell.hasValue === false ? theme.error : theme.muted}>
                {row.cell.disabled ? "# " : ""}
                {valueText === "locked" ? "locked (u)" : truncate(valueText, 18)}
              </Text>
              {row.cell.shared ? <Text color={theme.info}> ⧉shared</Text> : null}
            </Text>
          );
        })
      )}
      <Box marginTop={1}>
        <Text color={theme.muted} wrap="truncate">
          ● value · ◌ missing · ◆ shared · # disabled · *** secret
        </Text>
      </Box>
    </Box>
  );
}

function GlobalDetail({ state, name }: { state: AppState; name: string }): React.ReactElement {
  const def = state.registry.globals[name];
  if (def === undefined) return <Text color={theme.muted}>global removed</Text>;
  return (
    <Box flexDirection="column">
      <Text bold>{name}</Text>
      {def.description !== undefined ? <Row label="description">{def.description}</Row> : null}
      <Box marginTop={1}>
        <Text color={theme.muted} bold>
          PER-VAULT SOURCE
        </Text>
      </Box>
      {Object.entries(def.values)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([vault, v]) => (
          <Text key={vault} wrap="truncate">
            <Text bold={vault === state.activeVault}>{truncate(vault, 12).padEnd(13)}</Text>
            {v.source === "runtime" ? (
              <Text color={theme.info}>runtime — reference passes through literally</Text>
            ) : (
              <Text color={theme.success}>static = {truncate(v.value, 20)}</Text>
            )}
          </Text>
        ))}
    </Box>
  );
}

export function inspectorBody(state: AppState): React.ReactElement {
  if (state.focus === "sidebar") {
    const entry = selectedSidebarEntry(state);
    if (entry?.kind === "vault") return <VaultDetail state={state} name={entry.name} />;
    if (entry?.kind === "consumer") return <ConsumerDetail state={state} name={entry.name} />;
    return <Text color={theme.muted}>select a vault or consumer</Text>;
  }
  const id = selectedMainId(state);
  if (id === undefined) return <Text color={theme.muted}>nothing selected</Text>;
  switch (state.tab) {
    case "variables":
      return (
        <VariableDetail state={state} name={id} wiringSelected={state.inspectorIndex} showWiringCursor={state.focus === "inspector"} />
      );
    case "globals":
      return <GlobalDetail state={state} name={id} />;
    case "groups": {
      const members = Object.entries(state.registry.variables)
        .filter(([, v]) => v.groupKey === id)
        .map(([n]) => n)
        .sort();
      return (
        <Box flexDirection="column">
          <Text bold>{state.registry.groups[id]?.title ?? id}</Text>
          <Row label="key">{id}</Row>
          <Row label="members">{members.length === 0 ? "none" : members.join(", ")}</Row>
          <Text color={theme.muted}>groups are display-only section headers</Text>
        </Box>
      );
    }
    case "compose":
      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate">
            {id}
          </Text>
          <Text color={theme.muted} wrap="truncate">
            menv rewrites only the lines between hand-authored markers:
          </Text>
          <Text color={theme.info}># &lt;menv:consumer&gt; … # &lt;/menv&gt;</Text>
        </Box>
      );
    case "backups":
      return (
        <Box flexDirection="column">
          <Text bold>{id}</Text>
          <Row label="path">.menv/backups/{id}/</Row>
          <Text color={theme.muted}>⏎ restores this snapshot (with confirmation)</Text>
        </Box>
      );
  }
}

export function Inspector({ state, width }: { state: AppState; width: number }): React.ReactElement {
  return (
    <Pane title="[3] inspector" focused={state.focus === "inspector"} width={width}>
      {inspectorBody(state)}
    </Pane>
  );
}
