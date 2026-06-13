// The visual form of --dry-run/--force: every mutation's plan, confirmed here.
// Vault ops render KEYS only — values never reach a plan surface.
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { OpResult } from "../../core/ops/util.ts";
import type { Plan } from "../../core/plan.ts";
import { theme } from "../theme.ts";
import { ModalFrame } from "./frame.tsx";

export function PlanView({ plan }: { plan: Plan }): React.ReactElement {
  const empty =
    plan.registry.length === 0 && plan.vaults.length === 0 && plan.files.length === 0 && plan.warnings.length === 0;
  return (
    <Box flexDirection="column">
      {plan.registry.map((op) => (
        <Text key={`r:${op.action}:${op.path}:${op.summary}`} wrap="truncate">
          <Text color={theme.info}>registry</Text> {op.action} <Text color={theme.muted}>{op.path}</Text> — {op.summary}
        </Text>
      ))}
      {plan.vaults.map((op) => (
        <Text key={`v:${op.vault}:${op.action}:${op.key}`} wrap="truncate">
          <Text color={theme.secret}>vault</Text> {op.vault}: {op.action} key <Text color={theme.muted}>{op.key}</Text>
        </Text>
      ))}
      {plan.files.map((op) => (
        <Text key={`f:${op.action}:${op.path}`} wrap="truncate">
          <Text color={op.action === "delete" ? theme.error : theme.warning}>file</Text> {op.action} {op.path}
        </Text>
      ))}
      {plan.warnings.map((w) => (
        <Text key={`w:${w.code}:${w.message}`} color={theme.warning} wrap="truncate">
          ⚠ {w.code}: {w.message}
        </Text>
      ))}
      {plan.blockers.map((b) => (
        <Text key={`b:${b.code}:${b.message}`} color={theme.error} wrap="truncate">
          ✖ {b.code}: {b.message}
        </Text>
      ))}
      {empty && plan.blockers.length === 0 ? <Text color={theme.muted}>no changes</Text> : null}
    </Box>
  );
}

export function PlanConfirmModal({
  title,
  op,
  danger,
  apply,
  isTop,
  onClose,
}: {
  title: string;
  op: OpResult;
  danger?: string;
  apply: (force: boolean) => Promise<void>;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  const [forceArmed, setForceArmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const blocked = op.plan.blockers.length > 0;
  useInput(
    (input, key) => {
      if (applying) return;
      if (key.escape) onClose();
      else if (input === "f" && blocked) setForceArmed(true);
      else if (key.return) {
        if (blocked && !forceArmed) return;
        setApplying(true);
        void apply(forceArmed).finally(() => onClose());
      }
    },
    { isActive: isTop },
  );
  const hints = blocked
    ? forceArmed
      ? "⏎ APPLY ANYWAY (forced) · esc cancel"
      : "blocked — f to arm force · esc cancel"
    : "⏎ apply · esc cancel";
  return (
    <ModalFrame title={`plan: ${title}`} danger={forceArmed || danger !== undefined} hints={applying ? "applying…" : hints}>
      {danger !== undefined ? (
        <Text color={theme.warning} wrap="wrap">
          ⚠ {danger}
        </Text>
      ) : null}
      <PlanView plan={op.plan} />
      {forceArmed ? (
        <Text color={theme.error} bold>
          force armed — blockers will be overridden (deliberate, dangerous)
        </Text>
      ) : null}
    </ModalFrame>
  );
}
