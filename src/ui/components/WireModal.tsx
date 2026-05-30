import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Consumer } from "../../core/types.ts";

export function WireModal({ consumers, wired, onToggle, onClose }: {
  consumers: Consumer[];
  wired: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
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
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Text>Wire to consumers (enter toggle / esc close):</Text>
      {consumers.map((c, i) => (
        <Text key={`${c.id}:${i}`} inverse={i === cursor}>
          [{wired.includes(c.id) ? "x" : " "}] {c.kind === "service" ? "svc " : ""}{c.name}
        </Text>
      ))}
    </Box>
  );
}
