import { Box, Text } from "ink";
import type React from "react";
import { ListRow, type Segment } from "../components/listRow.tsx";
import { Pane } from "../components/pane.tsx";
import { ScrollList } from "../components/scrollList.tsx";
import { sidebarEntries } from "../state/lists.ts";
import { truncate, vaultBadgeText } from "../state/selectors.ts";
import type { AppState } from "../state/store.tsx";
import { theme } from "../theme.ts";

export function Sidebar({
  state,
  height,
  width,
  roomy,
}: {
  state: AppState;
  height: number;
  width: number;
  roomy: boolean;
}): React.ReactElement {
  const entries = sidebarEntries(state.registry);
  const focused = state.focus === "sidebar";
  const inner = width - 4; // border + padding
  return (
    <Pane title="[1] scopes" focused={focused} width={width} roomy={roomy}>
      <ScrollList
        items={entries}
        selected={state.sidebarIndex}
        height={height}
        renderItem={(entry, _i, isSelected) => {
          if (entry.kind === "header") {
            return (
              <Text key={`h:${entry.title}`} color={theme.muted} bold>
                {"  \n"}
                {entry.title}
              </Text>
            );
          }
          if (entry.kind === "empty") {
            return (
              <Text key={`e:${entry.hint}`} color={theme.muted}>
                {"    "}
                {entry.hint}
              </Text>
            );
          }
          if (entry.kind === "vault") {
            const rt = state.vaults[entry.name];
            const isDefault = state.registry.defaults.vault === entry.name;
            const isActive = state.activeVault === entry.name;
            const locked = rt !== undefined && !rt.unlocked;
            // Lock state only: locked vaults carry "⚿"; unlocked ones show nothing.
            const badge = rt === undefined ? "" : vaultBadgeText({ unlocked: rt.unlocked, isDefault });
            // Active vault = accent + bold name (the band/bar marks the cursor).
            const segments: Segment[] = [
              { text: truncate(entry.name, inner - 6), color: isActive ? theme.accent : undefined, bold: isActive },
            ];
            if (badge !== "") {
              segments.push({ text: ` ${badge}`, color: locked ? theme.error : theme.muted, dim: !locked });
            }
            return <ListRow key={`v:${entry.name}`} segments={segments} selected={isSelected} focused={focused} />;
          }
          const isFiltered = state.consumerFilter === entry.name;
          const segments: Segment[] = [
            { text: truncate(entry.name, inner - 4), color: isFiltered ? theme.accent : undefined, bold: isFiltered },
          ];
          if (isFiltered) segments.push({ text: " ✓", color: theme.accent });
          return <ListRow key={`c:${entry.name}`} segments={segments} selected={isSelected} focused={focused} />;
        }}
      />
      <Box marginTop={1}>
        <Text color={theme.muted} wrap="truncate">
          {"  "}⚿ locked · * default
        </Text>
      </Box>
    </Pane>
  );
}
