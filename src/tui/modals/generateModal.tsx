// The generate flow: scope → preview (would-write report) → apply. Reports
// paths, never content. Foreign files (no marker) are refused and listed.
import { Spinner } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { MenvError } from "../../core/errors.ts";
import type { TuiContext } from "../state/data.ts";
import type { GenerateScope } from "../state/generate.ts";
import { applyGenerate, computeGeneratePreview } from "../state/generate.ts";
import type { Store } from "../state/store.tsx";
import { theme } from "../theme.ts";
import { ModalFrame } from "./frame.tsx";

type Phase =
  | { step: "loading" }
  | { step: "preview"; pending: Awaited<ReturnType<typeof computeGeneratePreview>> }
  | { step: "applying" }
  | { step: "error"; message: string };

export function GenerateModal({
  store,
  ctx,
  isTop,
  onClose,
}: {
  store: Store;
  ctx: TuiContext;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  const scopeRef = useRef<GenerateScope>({
    vault: store.state.activeVault,
    consumer: store.state.consumerFilter ?? undefined,
  });
  const scope = scopeRef.current;
  const [phase, setPhase] = useState<Phase>({ step: "loading" });

  // The store object's identity changes on every dispatch — go through a ref
  // so the preview computes exactly once for the scope captured at open time.
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    let alive = true;
    computeGeneratePreview(storeRef.current, ctx, scope)
      .then((pending) => {
        if (alive) setPhase({ step: "preview", pending });
      })
      .catch((e: unknown) => {
        if (alive) setPhase({ step: "error", message: e instanceof MenvError ? `${e.code}: ${e.message}` : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [ctx, scope]);

  useInput(
    (_input, key) => {
      if (key.escape && phase.step !== "applying") onClose();
      else if (key.return && phase.step === "preview") {
        setPhase({ step: "applying" });
        void applyGenerate(store, ctx, phase.pending)
          .catch((e: unknown) => undefined === e)
          .finally(() => onClose());
      } else if (key.return && phase.step === "error") onClose();
    },
    { isActive: isTop },
  );

  const scopeText = `vault "${scope.vault}"${scope.consumer !== undefined ? ` · consumer "${scope.consumer}" (compose skipped)` : " · all consumers + compose"}`;
  return (
    <ModalFrame
      title={`generate — ${scopeText}`}
      width={76}
      hints={phase.step === "preview" ? "⏎ write files · esc cancel" : "esc cancel"}
    >
      {phase.step === "loading" ? <Spinner label="computing what generate would write…" /> : null}
      {phase.step === "applying" ? <Spinner label="writing…" /> : null}
      {phase.step === "error" ? (
        <Box flexDirection="column">
          <Text color={theme.error} wrap="wrap">
            ✖ {phase.message}
          </Text>
          <Text color={theme.muted}>locked vault? unlock it from the sidebar (u) and retry</Text>
        </Box>
      ) : null}
      {phase.step === "preview" ? (
        <Box flexDirection="column">
          <Text>
            would write <Text color={theme.success}>{phase.pending.report.written.length}</Text> · unchanged{" "}
            <Text color={theme.muted}>{phase.pending.report.unchanged.length}</Text> · refused{" "}
            <Text color={phase.pending.report.refused.length > 0 ? theme.error : theme.muted}>
              {phase.pending.report.refused.length}
            </Text>
          </Text>
          {phase.pending.report.written.slice(0, 10).map((p) => (
            <Text key={p} color={theme.success} wrap="truncate">
              {"  "}~ {p}
            </Text>
          ))}
          {phase.pending.report.written.length > 10 ? (
            <Text color={theme.muted}> … and {phase.pending.report.written.length - 10} more</Text>
          ) : null}
          {phase.pending.report.refused.map((p) => (
            <Text key={p} color={theme.error} wrap="truncate">
              {"  "}! {p} — exists without the menv marker (yours now; left as is)
            </Text>
          ))}
          {phase.pending.report.warnings.map((w) => (
            <Text key={`${w.code}:${w.message}`} color={theme.warning} wrap="truncate">
              {"  "}⚠ {w.code}: {w.message}
            </Text>
          ))}
          {phase.pending.report.written.length === 0 ? <Text color={theme.muted}>everything is up to date</Text> : null}
        </Box>
      ) : null}
    </ModalFrame>
  );
}
