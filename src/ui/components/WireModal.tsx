import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Consumer } from "../../core/types.ts";
import { listWindow } from "./listWindow.ts";
import { MoreIndicator } from "./MoreIndicator.tsx";

export function WireModal({ varName, consumers, wired, onToggle, onClose, height }: {
  varName: string;
  consumers: Consumer[];
  wired: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
  height?: number;
}) {
  const [cursor, setCursor] = useState(0);
  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(consumers.length - 1, c + 1));
    if (key.return && consumers[cursor]) onToggle(consumers[cursor].id);
  });
  const maxItems = height ? Math.max(0, height - 5) : consumers.length;
  const windowed = listWindow(consumers, cursor, maxItems);
  return (
    <Box flexDirection="column" height={height} borderStyle="round" borderColor="blue" paddingX={1}>
      <Text>Wire <Text bold>{varName}</Text> to consumers <Text color="gray">(enter toggle / esc close)</Text></Text>
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((c, i) => {
        const idx = windowed.offset + i;
        return (
          <Text key={`${c.id}:${idx}`} inverse={idx === cursor}>
            [{wired.includes(c.id) ? "x" : " "}] {c.name}
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={consumers.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}
