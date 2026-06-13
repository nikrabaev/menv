// Header, status line, and footer hint bar — the persistent chrome around the
// panes. All three are one row each.

import { Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";
import type React from "react";
import type { Finding } from "../../cli/check.ts";
import type { KeyContext } from "../keys.ts";
import { footerHints } from "../keys.ts";
import { vaultBadgeText } from "../state/selectors.ts";
import type { AppState } from "../state/store.tsx";
import { theme } from "../theme.ts";

export function Header({ state, repoName }: { state: AppState; repoName: string }): React.ReactElement {
  const rt = state.vaults[state.activeVault];
  const badge =
    rt === undefined
      ? ""
      : vaultBadgeText({
          encrypted: rt.encrypted,
          unlocked: rt.unlocked,
          isDefault: state.registry.defaults.vault === state.activeVault,
          isActive: true,
        });
  const lockWord = rt === undefined ? "" : rt.unlocked ? "unlocked" : "LOCKED";
  return (
    <Box paddingX={1} gap={1}>
      <Text bold color={theme.accent}>
        menv
      </Text>
      <Text color={theme.muted}>{repoName}</Text>
      <Text>
        vault: <Text bold>{state.activeVault}</Text>{" "}
        <Text color={rt?.unlocked === false ? theme.error : theme.muted}>
          [{badge} {lockWord}]
        </Text>
      </Text>
      <Text>
        consumer: <Text bold>{state.consumerFilter ?? "all"}</Text>
      </Text>
    </Box>
  );
}

export function findingsSummary(findings: Finding[] | null): { text: string; color: string } {
  if (findings === null) return { text: "checks: not run (c)", color: theme.muted };
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  if (errors === 0 && warnings === 0) return { text: "✓ checks pass", color: theme.success };
  const stale = findings.some((f) => f.code === "STALE");
  const parts = [errors > 0 ? `✖${errors}` : "", warnings > 0 ? `⚠${warnings}` : "", stale ? "stale — g to generate" : ""]
    .filter((p) => p !== "")
    .join(" ");
  return { text: `${parts} (c to view)`, color: errors > 0 ? theme.error : theme.warning };
}

export function StatusBar({ state }: { state: AppState }): React.ReactElement {
  const summary = findingsSummary(state.findings);
  const tone = state.status?.tone;
  const color = tone === "error" ? theme.error : tone === "success" ? theme.success : theme.muted;
  return (
    <Box paddingX={1} gap={2}>
      <Box flexGrow={1}>
        {state.busy !== null ? (
          <Spinner label={state.busy} />
        ) : (
          <Text color={color} wrap="truncate">
            {state.status?.text ?? ""}
          </Text>
        )}
      </Box>
      <Text color={summary.color} wrap="truncate">
        {summary.text}
      </Text>
    </Box>
  );
}

export function Footer({ context }: { context: KeyContext }): React.ReactElement {
  const hints = footerHints(context);
  return (
    <Box paddingX={1}>
      <Text wrap="truncate" color={theme.muted}>
        {hints.map((h, i) => (
          <Text key={h.key + h.label}>
            {i > 0 ? " · " : ""}
            <Text color={theme.accent}>{h.key}</Text> {h.label}
          </Text>
        ))}
      </Text>
    </Box>
  );
}
