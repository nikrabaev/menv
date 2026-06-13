import { Box, Text } from "ink";
import type React from "react";
import { Pane } from "../components/pane.tsx";
import { ScrollList } from "../components/scrollList.tsx";
import { sidebarEntries } from "../state/lists.ts";
import { truncate, vaultBadgeText } from "../state/selectors.ts";
import type { AppState } from "../state/store.tsx";
import { theme } from "../theme.ts";

export function Sidebar({ state, height, width }: { state: AppState; height: number; width: number }): React.ReactElement {
  const entries = sidebarEntries(state.registry);
  const focused = state.focus === "sidebar";
  const inner = width - 4; // border + padding
  return (
    <Pane title="[1] scopes" focused={focused} width={width}>
      <ScrollList
        items={entries}
        selected={state.sidebarIndex}
        height={height}
        renderItem={(entry, _i, isSelected) => {
          if (entry.kind === "header") {
            return (
              <Text key={`h:${entry.title}`} color={theme.muted} bold>
                {entry.title}
              </Text>
            );
          }
          if (entry.kind === "empty") {
            return (
              <Text key={`e:${entry.hint}`} color={theme.muted}>
                {"  "}
                {entry.hint}
              </Text>
            );
          }
          if (entry.kind === "vault") {
            const rt = state.vaults[entry.name];
            const badge =
              rt === undefined
                ? ""
                : vaultBadgeText({
                    encrypted: rt.encrypted,
                    unlocked: rt.unlocked,
                    isDefault: state.registry.defaults.vault === entry.name,
                    isActive: state.activeVault === entry.name,
                  });
            const isActive = state.activeVault === entry.name;
            const locked = rt !== undefined && !rt.unlocked;
            return (
              <Text key={`v:${entry.name}`} inverse={isSelected && focused}>
                <Text color={theme.accent}>{isActive ? "› " : "  "}</Text>
                <Text bold={isActive}>{truncate(entry.name, inner - 6)}</Text>
                <Text color={locked ? theme.error : theme.muted}> {badge}</Text>
              </Text>
            );
          }
          const isFiltered = state.consumerFilter === entry.name;
          return (
            <Text key={`c:${entry.name}`} inverse={isSelected && focused}>
              <Text color={theme.accent}>{isFiltered ? "› " : "  "}</Text>
              <Text bold={isFiltered}>{truncate(entry.name, inner - 4)}</Text>
              {isFiltered ? <Text color={theme.accent}> ✓</Text> : null}
            </Text>
          );
        }}
      />
      <Box marginTop={1}>
        <Text color={theme.muted} wrap="truncate">
          E enc · P plain · +/- un/locked · * default
        </Text>
      </Box>
    </Pane>
  );
}
