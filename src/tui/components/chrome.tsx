// Header, status line, and footer hint bar — the persistent chrome around the
// panes. All three are one row each.

import { Badge, Spinner, StatusMessage } from "@inkjs/ui";
import { Box, Text } from "ink";
import type React from "react";
import type { Finding } from "../../cli/check.ts";
import type { KeyContext } from "../keys.ts";
import { footerHints } from "../keys.ts";
import { LOCK_GLYPH } from "../state/selectors.ts";
import type { AppState } from "../state/store.tsx";
import { theme } from "../theme.ts";

export function Header({ state, repoName }: { state: AppState; repoName: string }): React.ReactElement {
  const rt = state.vaults[state.activeVault];
  const isDefault = state.registry.defaults.vault === state.activeVault;
  // Lock state only: "⚿ locked" when sealed, "unlocked" when open; "*" = default.
  const lockWord = rt === undefined ? "" : rt.unlocked ? "unlocked" : `${LOCK_GLYPH} locked`;
  const pillText = `${lockWord}${isDefault ? " *" : ""}`;
  // Pill color encodes lock state: green open, red locked.
  const pillColor = rt === undefined ? theme.muted : rt.unlocked ? theme.success : theme.error;
  return (
    <Box paddingX={1} gap={1}>
      <Text bold color={theme.accent}>
        menv
      </Text>
      <Text color={theme.muted}>{repoName}</Text>
      <Box>
        <Text>
          vault: <Text bold>{state.activeVault}</Text>{" "}
        </Text>
        {rt !== undefined ? <Badge color={pillColor}>{pillText}</Badge> : null}
      </Box>
      <Text>
        consumer:{" "}
        <Text bold color={state.consumerFilter !== null ? theme.accent : undefined}>
          {state.consumerFilter ?? "all"}
        </Text>
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
  const variant = tone === "error" ? "error" : tone === "success" ? "success" : "info";
  return (
    <Box paddingX={1} gap={2}>
      <Box flexGrow={1}>
        {state.busy !== null ? (
          <Spinner label={state.busy} />
        ) : state.status !== null ? (
          <StatusMessage variant={variant}>{state.status.text}</StatusMessage>
        ) : null}
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
