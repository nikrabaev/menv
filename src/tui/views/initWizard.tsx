// Uninitialized repo → a two-choice wizard (the brief's "empty state with a
// clear next step"). Encrypted is the default, exactly like `menv init`.
import { Box, Text, useApp, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import { runInit } from "../../cli/init.ts";
import { MenvError } from "../../core/errors.ts";
import { theme } from "../theme.ts";

export function InitWizard({ root, onDone }: { root: string; onDone: () => void }): React.ReactElement {
  const { exit } = useApp();
  const [encrypt, setEncrypt] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useInput((input, key) => {
    if (busy) return;
    if (input === "q" || key.escape) exit();
    else if (key.upArrow || key.downArrow || input === "j" || input === "k") setEncrypt((e) => !e);
    else if (key.return) {
      setBusy(true);
      runInit(root, { encrypt })
        .then(() => onDone())
        .catch((e: unknown) => {
          setBusy(false);
          setError(e instanceof MenvError ? e.message : String(e));
        });
    }
  });
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={theme.accent}>
        menv — no menv.json found in {root}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Initialize a new registry with a local vault:</Text>
        <Text inverse={encrypt}>
          {encrypt ? "› " : "  "}encrypted vault <Text color={theme.muted}>(age passphrase — ciphertext is committable; recommended)</Text>
        </Text>
        <Text inverse={!encrypt}>
          {!encrypt ? "› " : "  "}plaintext vault <Text color={theme.muted}>(stays git-ignored — menv check enforces it)</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>↑↓ choose · ⏎ create menv.json + .gitignore block · q quit</Text>
      </Box>
      {busy ? <Text color={theme.muted}>initializing…</Text> : null}
      {error !== null ? (
        <Text color={theme.error} wrap="wrap">
          ✖ {error}
        </Text>
      ) : null}
    </Box>
  );
}
