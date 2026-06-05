import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Consumer } from "../../core/types.ts";
import { listWindow } from "./listWindow.ts";
import { MoreIndicator } from "./MoreIndicator.tsx";

export function WireModal({ varName, consumers, wired, unapplied = [], env, onToggle, onToggleApplied, onClose, height }: {
  varName: string;
  consumers: Consumer[];
  wired: string[];
  // Consumer ids the var is wired to but not applied in for `env` (rendered "off").
  unapplied?: string[];
  env?: string;
  onToggle: (id: string) => void;
  // Toggle applied-in-`env` for the highlighted wired consumer (the `a` key).
  onToggleApplied?: (id: string) => void;
  onClose: () => void;
  height?: number;
}) {
  const [cursor, setCursor] = useState(0);
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(consumers.length - 1, c + 1));
    if (key.return && consumers[cursor]) onToggle(consumers[cursor].id);
    // `a` flips applied vs commented for the env, but only on a wired consumer.
    if (input === "a" && onToggleApplied && consumers[cursor] && wired.includes(consumers[cursor].id)) {
      onToggleApplied(consumers[cursor].id);
    }
  });
  const maxItems = height ? Math.max(0, height - 5) : consumers.length;
  const windowed = listWindow(consumers, cursor, maxItems);
  const envLabel = env ? ` ${env}` : "";
  return (
    <Box flexDirection="column" height={height} borderStyle="round" borderColor="blue" paddingX={1}>
      <Text>Wire <Text bold>{varName}</Text> to consumers <Text color="gray">(enter wire · a applied · esc close)</Text></Text>
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((c, i) => {
        const idx = windowed.offset + i;
        const isWiredHere = wired.includes(c.id);
        return (
          <Text key={`${c.id}:${idx}`} inverse={idx === cursor}>
            [{isWiredHere ? "x" : " "}] {c.name}
            {isWiredHere && unapplied.includes(c.id) ? <Text color="blackBright"> · off{envLabel}</Text> : null}
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={consumers.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}
