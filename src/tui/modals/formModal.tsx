// Generic field-list form: text / password (masked) / select (◂ ▸ cycles) /
// toggle (space flips). ↑↓ move between fields, ⏎ advances (submits from the
// last row), esc cancels.
import { PasswordInput, TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { FormField, FormSpec } from "../state/store.tsx";
import { theme } from "../theme.ts";
import { ModalFrame } from "./frame.tsx";

function initialValues(fields: FormField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    out[f.name] = f.initial ?? (f.kind === "select" ? (f.options?.[0]?.value ?? "") : f.kind === "toggle" ? "false" : "");
  }
  return out;
}

export function FormModal({
  form,
  isTop,
  onClose,
}: {
  form: FormSpec;
  isTop: boolean;
  onClose: () => void;
}): React.ReactElement {
  const [values, setValues] = useState(() => initialValues(form.fields));
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rows = form.fields.length + 1; // + submit row
  const field = form.fields[cursor];
  const set = (name: string, value: string): void => setValues((v) => ({ ...v, [name]: value }));

  const submit = (): void => {
    for (const f of form.fields) {
      if (f.required === true && (values[f.name] ?? "") === "") {
        setError(`"${f.label}" is required`);
        setCursor(form.fields.indexOf(f));
        return;
      }
    }
    onClose();
    void form.onSubmit(values);
  };

  const advance = (): void => {
    if (cursor >= rows - 1) submit();
    else setCursor(cursor + 1);
  };

  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
        return;
      }
      if (key.upArrow) setCursor(Math.max(0, cursor - 1));
      else if (key.downArrow || key.tab) setCursor(Math.min(rows - 1, cursor + 1));
      else if (field === undefined) {
        // submit row
        if (key.return) submit();
      } else if (field.kind === "select") {
        const opts = field.options ?? [];
        const at = Math.max(
          0,
          opts.findIndex((o) => o.value === values[field.name]),
        );
        if (key.leftArrow) set(field.name, opts[(at - 1 + opts.length) % opts.length]?.value ?? "");
        else if (key.rightArrow || input === " ") set(field.name, opts[(at + 1) % opts.length]?.value ?? "");
        else if (key.return) advance();
      } else if (field.kind === "toggle") {
        if (input === " " || key.leftArrow || key.rightArrow) set(field.name, values[field.name] === "true" ? "false" : "true");
        else if (key.return) advance();
      }
      // text/password: the input component owns chars + ⏎ (its onSubmit advances)
    },
    { isActive: isTop },
  );

  return (
    <ModalFrame title={form.title} hints="↑↓ fields · ⏎ next/submit · esc cancel" width={72}>
      {form.fields.map((f, i) => {
        const selected = i === cursor;
        const marker = selected ? "› " : "  ";
        if (f.kind === "text" || f.kind === "password") {
          const Input = f.kind === "password" ? PasswordInput : TextInput;
          return (
            <Box key={f.name}>
              <Text color={selected ? theme.accent : undefined} bold={selected}>
                {marker}
                {f.label.padEnd(34)}{" "}
              </Text>
              {selected ? (
                <Input
                  key={`${f.name}:active`}
                  defaultValue={values[f.name] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(v) => set(f.name, v)}
                  onSubmit={advance}
                />
              ) : (
                <Text color={theme.muted}>
                  {f.kind === "password"
                    ? "*".repeat((values[f.name] ?? "").length)
                    : (values[f.name] ?? "") === ""
                      ? (f.placeholder ?? "")
                      : values[f.name]}
                </Text>
              )}
            </Box>
          );
        }
        if (f.kind === "toggle") {
          const on = values[f.name] === "true";
          return (
            <Box key={f.name}>
              <Text color={selected ? theme.accent : undefined} bold={selected}>
                {marker}
                {f.label.padEnd(34)}{" "}
              </Text>
              <Text color={on ? theme.success : theme.muted}>{on ? "[x] yes" : "[ ] no"}</Text>
              {selected ? <Text color={theme.muted}> (space flips)</Text> : null}
            </Box>
          );
        }
        const current = f.options?.find((o) => o.value === values[f.name]);
        return (
          <Box key={f.name}>
            <Text color={selected ? theme.accent : undefined} bold={selected}>
              {marker}
              {f.label.padEnd(34)}{" "}
            </Text>
            <Text>
              ◂ {current?.label ?? "—"} ▸
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text bold={cursor === rows - 1} color={cursor === rows - 1 ? theme.accent : theme.muted} inverse={cursor === rows - 1}>
          [ {form.submitLabel ?? "submit"} ]
        </Text>
      </Box>
      {error !== null ? <Text color={theme.error}>✖ {error}</Text> : null}
    </ModalFrame>
  );
}
