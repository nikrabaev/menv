// Human-mode value editor for ONE consumer's (consumer, value) row. You can
// type a fresh value (isolating onto a private key), adopt a key another
// consumer of this variable already uses (sharing its storage and value), and
// flip the consumer's `disabled` flag. Submitting routes through the normal
// plan→confirm gate (mutations.applyValueEdit); adopting a key may orphan the
// consumer's old key, which prompts before dropping it.
import { PasswordInput, TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { TuiContext } from "../state/data.ts";
import { applyValueEdit } from "../state/mutations.ts";
import { truncate } from "../state/selectors.ts";
import type { Store } from "../state/store.tsx";
import { theme } from "../theme.ts";
import { ModalFrame } from "./frame.tsx";

interface Option {
  key: string;
  value: string | undefined;
  consumers: string[];
}

// Distinct keys held by OTHER consumers of this variable (excluding the one this
// consumer already uses) — adopting one shares its storage. Grouped by key, the
// most-shared first.
function otherKeys(mapping: Record<string, { key: string }>, values: Record<string, string>, self: string): Option[] {
  const selfKey = mapping[self]?.key;
  const byKey = new Map<string, string[]>();
  for (const [consumer, entry] of Object.entries(mapping)) {
    if (consumer === self || entry.key === selfKey) continue;
    byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), consumer]);
  }
  return [...byKey.entries()]
    .map(([key, consumers]) => ({ key, value: values[key], consumers: consumers.sort() }))
    .sort((a, b) => b.consumers.length - a.consumers.length || a.key.localeCompare(b.key));
}

export function ValueEditModal({
  store,
  ctx,
  name,
  vault,
  consumer,
  isTop,
  onClose,
}: {
  store: Store;
  ctx: TuiContext;
  name: string;
  vault: string;
  consumer: string;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  const def = store.state.registry.variables[name];
  const secret = def?.secret === true;
  const mapping = def?.vaultMapping[vault] ?? {};
  const entry = mapping[consumer];
  const values = store.state.vaults[vault]?.values ?? {};
  const currentValue = entry !== undefined ? values[entry.key] : undefined;
  const options = otherKeys(mapping, values, consumer);

  const [typed, setTyped] = useState(secret ? "" : (currentValue ?? ""));
  const [adoptKey, setAdoptKey] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(entry?.disabled === true);
  const [cursor, setCursor] = useState(0);

  // rows: 0 = value input, 1..k = key options, k+1 = disabled toggle, k+2 = submit
  const k = options.length;
  const toggleRow = k + 1;
  const submitRow = k + 2;
  const totalRows = k + 3;

  // adopt wins; otherwise a typed value only counts when it actually changed.
  const typedValue: string | null = secret ? (typed === "" ? null : typed) : typed === (currentValue ?? "") ? null : typed;

  const submit = (): void => {
    onClose();
    applyValueEdit(store, ctx, name, vault, consumer, {
      adoptKey: adoptKey ?? undefined,
      value: adoptKey !== null ? undefined : (typedValue ?? undefined),
      disabled,
    });
  };

  const adopt = (key: string): void => {
    setAdoptKey(key);
    setCursor(submitRow);
  };

  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) {
        setCursor(Math.max(0, cursor - 1));
        return;
      }
      if (key.downArrow || key.tab) {
        setCursor(Math.min(totalRows - 1, cursor + 1));
        return;
      }
      if (cursor === 0) return; // the text input owns chars + ⏎ (onSubmit advances)
      if (cursor >= 1 && cursor <= k) {
        if (key.return || input === " ") adopt(options[cursor - 1]?.key ?? "");
        return;
      }
      if (cursor === toggleRow) {
        if (input === " " || key.leftArrow || key.rightArrow) setDisabled(!disabled);
        else if (key.return) setCursor(cursor + 1);
        return;
      }
      if (cursor === submitRow && key.return) submit();
    },
    { isActive: isTop },
  );

  const Input = secret ? PasswordInput : TextInput;
  const valueDisplay = secret ? "*".repeat(typed.length) : typed === "" ? "(empty)" : typed;

  return (
    <ModalFrame title={`Edit ${name} · ${consumer} (vault ${vault})`} hints="↑↓ move · ⏎ pick/next · space toggle · esc cancel" width={74}>
      <Box>
        <Text color={cursor === 0 ? theme.accent : undefined} bold={cursor === 0}>
          {cursor === 0 ? "› " : "  "}
          {secret ? "value (secret)" : "value"}
          {"".padEnd(Math.max(1, 16 - (secret ? 14 : 5)))}
        </Text>
        {cursor === 0 ? (
          <Input
            key="value:active"
            defaultValue={typed}
            placeholder={secret ? "leave empty to keep current" : undefined}
            onChange={(v) => {
              setTyped(v);
              setAdoptKey(null);
            }}
            onSubmit={() => setCursor(Math.min(totalRows - 1, 1))}
          />
        ) : (
          <Text color={theme.muted}>{valueDisplay}</Text>
        )}
      </Box>

      {options.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted} dimColor>
            or adopt a key another consumer uses (shares its value):
          </Text>
          {options.map((o, i) => {
            const row = i + 1;
            const on = adoptKey === o.key;
            const preview =
              o.value === undefined ? "∅" : secret && !store.state.revealSecrets ? "***" : truncate(o.value, 28);
            return (
              <Text key={o.key} color={cursor === row ? theme.accent : undefined} bold={cursor === row}>
                {cursor === row ? "› " : "  "}
                {on ? "◉ " : "○ "}
                {preview}
                <Text color={theme.muted} dimColor>
                  {"  · "}
                  {o.consumers.join(", ")}
                </Text>
              </Text>
            );
          })}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={cursor === toggleRow ? theme.accent : undefined} bold={cursor === toggleRow}>
          {cursor === toggleRow ? "› " : "  "}
          disabled{"".padEnd(9)}
        </Text>
        <Text color={disabled ? theme.warning : theme.muted}>{disabled ? "[x] yes" : "[ ] no"}</Text>
        {cursor === toggleRow ? <Text color={theme.muted}> (space flips)</Text> : null}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.muted}>
          {adoptKey !== null
            ? `shares ${options.find((o) => o.key === adoptKey)?.consumers.join(", ") ?? "another consumer"}'s value`
            : typedValue === null
              ? "value unchanged"
              : `value → ${secret ? "***" : truncate(typedValue, 40)}`}
        </Text>
      </Box>
      <Box>
        <Text bold={cursor === submitRow} color={cursor === submitRow ? theme.accent : theme.muted} inverse={cursor === submitRow}>
          [ apply ]
        </Text>
      </Box>
    </ModalFrame>
  );
}
