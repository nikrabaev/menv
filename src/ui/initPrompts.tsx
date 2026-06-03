import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { KeyBackendKind } from "../core/types.ts";
import type { PassphraseProvider } from "../crypto/identity.ts";
import { inlinePrompt } from "./components/inlinePrompt.tsx";
import { TextInput } from "./components/TextInput.tsx";

// ── backend picker ────────────────────────────────────────────────────────────

interface Choice {
  kind: KeyBackendKind;
  label: string;
  hint: string;
}

const CHOICES: Choice[] = [
  { kind: "keychain", label: "Keychain", hint: "macOS only" },
  { kind: "1password", label: "1Password", hint: "OS-independent · needs the `op` CLI" },
  { kind: "password", label: "Password", hint: "OS-independent · passphrase each run" },
];

function BackendMenu({ onSelect }: { onSelect: (k: KeyBackendKind) => void }) {
  const [cursor, setCursor] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(CHOICES.length - 1, c + 1));
    if (key.return) onSelect(CHOICES[cursor]!.kind);
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Text>
        Where should menv store the secret key? <Text color="gray">(↑/↓ move · enter select)</Text>
      </Text>
      {CHOICES.map((c, i) => (
        <Text key={c.kind} inverse={i === cursor}>
          {c.label} <Text color="gray">— {c.hint}</Text>
        </Text>
      ))}
    </Box>
  );
}

export async function promptBackendKind(): Promise<KeyBackendKind> {
  return inlinePrompt<KeyBackendKind>((resolve) => <BackendMenu onSelect={resolve} />, "keychain");
}

// ── passphrase provider ───────────────────────────────────────────────────────

function PassphraseField({ label, error, onSubmit }: {
  label: string;
  error?: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={error ? "red" : "blue"} paddingX={1}>
      <Text>{label}</Text>
      <Box>
        <Text color="gray">{"> "}</Text>
        <TextInput value={value} onChange={setValue} mask="•" onSubmit={onSubmit} />
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
    </Box>
  );
}

// Two-step "set a new passphrase" flow (enter + confirm) in one mount, so the
// mismatch error can be shown inline. Resolves only on a matching, non-empty pair.
function CreatePassphrase({ onDone }: { onDone: (value: string) => void }) {
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string | undefined>();
  // Remount the field each step/attempt so its internal caret resets cleanly.
  const [nonce, setNonce] = useState(0);

  const submit = (v: string) => {
    if (stage === "enter") {
      if (!v) { setError("Passphrase can't be empty"); setNonce((n) => n + 1); return; }
      setFirst(v);
      setError(undefined);
      setStage("confirm");
      setNonce((n) => n + 1);
    } else if (v === first) {
      onDone(v);
    } else {
      setError("Passphrases don't match — start again");
      setFirst("");
      setStage("enter");
      setNonce((n) => n + 1);
    }
  };

  const label = stage === "enter"
    ? "Choose a passphrase to protect the menv key:"
    : "Confirm the passphrase:";
  return <PassphraseField key={nonce} label={label} error={error} onSubmit={submit} />;
}

// Masked single-value prompt for the headless `set` command when run on a TTY
// with no value given as an arg or piped on stdin. Input is masked because the
// value may well be a secret; pipe it on stdin to avoid the prompt entirely.
export async function promptValue(label: string): Promise<string> {
  return inlinePrompt<string>(
    (resolve) => <PassphraseField label={label} onSubmit={resolve} />,
    "",
  );
}

async function askUnlock(): Promise<string> {
  return inlinePrompt<string>(
    (resolve) => <PassphraseField label="Enter the menv passphrase:" onSubmit={resolve} />,
    "",
  );
}

// Interactive passphrase provider for the init/TUI paths. `interactive: true`
// lets the password backend re-prompt `unlock` after a wrong passphrase.
export function interactivePassphraseProvider(): PassphraseProvider {
  return {
    interactive: true,
    async unlock() { return askUnlock(); },
    async create() {
      return inlinePrompt<string>((resolve) => <CreatePassphrase onDone={resolve} />, "");
    },
  };
}
