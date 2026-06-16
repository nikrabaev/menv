// The small modals: confirm, quit, unlock, reveal, consumer pick, findings,
// help, and the narrow-terminal detail view.
import { PasswordInput, Select, Spinner, StatusMessage } from "@inkjs/ui";
import { Box, Text, useApp, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import { MenvError } from "../../core/errors.ts";
import { ScrollList } from "../components/scrollList.tsx";
import { contextHints, HELP_SECTIONS } from "../keys.ts";
import type { TuiContext } from "../state/data.ts";
import { tryUnlock } from "../state/mutations.ts";
import type { Store } from "../state/store.tsx";
import { theme } from "../theme.ts";
import { inspectorBody } from "../views/inspector.tsx";
import { ModalFrame } from "./frame.tsx";

export function ConfirmModal({
  title,
  body,
  danger,
  onConfirm,
  isTop,
  onClose,
}: {
  title: string;
  body: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  useInput(
    (input, key) => {
      if (key.escape || input === "n") onClose();
      else if (key.return || input === "y") {
        onClose();
        void onConfirm();
      }
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame title={title} danger={danger} hints="y/⏎ confirm · n/esc cancel">
      <Text wrap="wrap">{body}</Text>
    </ModalFrame>
  );
}

export function QuitModal({ isTop, onClose }: { isTop: boolean; onClose: () => void }): React.ReactElement {
  const { exit } = useApp();
  useInput(
    (input, key) => {
      if (key.escape || input === "n") onClose();
      else if (key.return || input === "y" || input === "q") exit();
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame title="Quit menv?" hints="y/⏎ quit · n/esc stay">
      <Text color={theme.muted}>all changes are already applied — nothing is pending</Text>
    </ModalFrame>
  );
}

// Asked when a re-key or unwire leaves a vault key with no remaining consumer.
// y/⏎ drops it, n keeps it (both proceed to the plan), esc abandons the action.
export function OrphanPromptModal({
  vault,
  keys,
  onChoose,
  isTop,
  onClose,
}: {
  vault: string;
  keys: string[];
  onChoose: (remove: boolean) => void;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (input === "y" || key.return) {
        onClose();
        onChoose(true);
      } else if (input === "n") {
        onClose();
        onChoose(false);
      }
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame title="Drop now-unused vault key?" hints="y/⏎ remove · n keep · esc cancel">
      <Text wrap="wrap">
        {keys.length === 1 ? "This key is" : `These ${keys.length} keys are`} no longer referenced by any consumer in vault "{vault}":
      </Text>
      {keys.map((k) => (
        <Text key={k} color={theme.muted}>
          {"  "}
          {k}
        </Text>
      ))}
      <Text color={theme.muted}>Removing drops the stored value; keeping leaves it for `menv check` to report.</Text>
    </ModalFrame>
  );
}

export function UnlockModal({
  store,
  ctx,
  vault,
  onUnlocked,
  isTop,
  onClose,
}: {
  store: Store;
  ctx: TuiContext;
  vault: string;
  onUnlocked?: () => void;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useInput(
    (_input, key) => {
      if (key.escape && !busy) onClose();
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame title={`Unlock vault "${vault}"`} hints="⏎ unlock · esc cancel (vault stays locked)">
      <Box gap={1}>
        <Text>passphrase:</Text>
        {busy ? (
          <Spinner label="opening vault…" />
        ) : (
          <PasswordInput
            onSubmit={(secret) => {
              setBusy(true);
              setError(null);
              tryUnlock(store, ctx, vault, secret)
                .then(() => {
                  onClose();
                  onUnlocked?.();
                })
                .catch((e: unknown) => {
                  setBusy(false);
                  setError(e instanceof MenvError ? e.message : String(e));
                })
                .finally(() => setBusy(false));
            }}
          />
        )}
      </Box>
      <Text color={theme.muted}>kept in memory for this session only — never written to disk</Text>
      {error !== null ? <StatusMessage variant="error">{error}</StatusMessage> : null}
    </ModalFrame>
  );
}

export function RevealModal({
  variable,
  vault,
  consumer,
  value,
  isTop,
  onClose,
}: {
  variable: string;
  vault: string;
  consumer?: string;
  value: string;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  useInput(
    (_input, key) => {
      if (key.escape || key.return) onClose();
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame
      title={`${variable} (vault ${vault}${consumer !== undefined ? `, ${consumer}` : ""})`}
      danger
      hints="esc/⏎ hide again"
    >
      <Text wrap="wrap">{value}</Text>
    </ModalFrame>
  );
}

export function ConsumerPickModal({
  title,
  consumers,
  onPick,
  isTop,
  onClose,
}: {
  title: string;
  consumers: string[];
  onPick: (consumer: string) => void;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  // esc is ours; ↑↓/⏎ belong to Select (disabled unless this modal is on top so
  // it never steals keys from a modal stacked above it).
  useInput(
    (_input, key) => {
      if (key.escape) onClose();
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame title={title} hints="↑↓ choose · ⏎ pick · esc cancel">
      <Select
        isDisabled={!isTop}
        visibleOptionCount={Math.min(consumers.length, 8)}
        options={consumers.map((c) => ({ label: c, value: c }))}
        onChange={(value) => {
          onClose();
          onPick(value);
        }}
      />
    </ModalFrame>
  );
}

export function FindingsModal({ store, isTop, onClose }: { store: Store; isTop: boolean; onClose: () => void }): React.ReactElement {
  const [index, setIndex] = useState(0);
  const findings = store.state.findings ?? [];
  useInput(
    (input, key) => {
      if (key.escape || input === "q") onClose();
      else if (key.upArrow || input === "k") setIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow || input === "j") setIndex((i) => Math.min(Math.max(0, findings.length - 1), i + 1));
    },
    { isActive: isTop },
  );
  const errors = findings.filter((f) => f.severity === "error").length;
  return (
    <ModalFrame
      title={`check — ${findings.length === 0 ? "all checks passed" : `${errors} error(s), ${findings.length - errors} warning(s)`}`}
      width={76}
      hints="↑↓ scroll · esc close"
    >
      {findings.length === 0 ? (
        <Text color={theme.success}>✓ nothing to report</Text>
      ) : (
        <ScrollList
          items={findings}
          selected={index}
          height={12}
          renderItem={(f, i, isSelected) => (
            <Text key={`${f.code}:${f.message.slice(0, 40)}:${i}`} inverse={isSelected} wrap="truncate">
              <Text color={f.severity === "error" ? theme.error : theme.warning}>
                {f.severity === "error" ? "✖" : "⚠"} {f.code}
              </Text>{" "}
              {f.message}
            </Text>
          )}
        />
      )}
    </ModalFrame>
  );
}

export function HelpModal({
  revealSecrets,
  isTop,
  onClose,
}: {
  revealSecrets: boolean;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  const [offset, setOffset] = useState(0);
  const lines: React.ReactElement[] = [];
  for (const section of HELP_SECTIONS) {
    lines.push(
      <Text key={`s:${section.title}`} bold color={theme.accent}>
        {section.title}
      </Text>,
    );
    for (const hint of contextHints(section.context, revealSecrets)) {
      lines.push(
        <Text key={`${section.title}:${hint.key}:${hint.label}`}>
          {"  "}
          <Text color={theme.accent}>{hint.key.padEnd(10)}</Text>
          {hint.label}
        </Text>,
      );
    }
  }
  lines.push(
    <Text key="legend" color={theme.muted}>
      legend: ● wired+value · ◌ missing value · ◆ shared key · # disabled · · unwired · S secret · ⚿ locked vault · * default vault
    </Text>,
  );
  const height = 16;
  useInput(
    (input, key) => {
      if (key.escape || input === "q" || input === "?") onClose();
      else if (key.upArrow || input === "k") setOffset((o) => Math.max(0, o - 1));
      else if (key.downArrow || input === "j") setOffset((o) => Math.min(Math.max(0, lines.length - height), o + 1));
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame title="help — every key, by context" width={80} hints="↑↓ scroll · esc close">
      <Box flexDirection="column">{lines.slice(offset, offset + height)}</Box>
    </ModalFrame>
  );
}

export function DetailModal({ store, isTop, onClose }: { store: Store; isTop: boolean; onClose: () => void }): React.ReactElement {
  useInput(
    (input, key) => {
      if (key.escape || key.return || input === "q") onClose();
    },
    { isActive: isTop },
  );
  return (
    <ModalFrame title="inspector" width={76} hints="esc close">
      {inspectorBody(store.state)}
    </ModalFrame>
  );
}
