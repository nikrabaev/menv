import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

export function NewVariableModal({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const nameRef = useRef("");
  const update = (next: string) => {
    nameRef.current = next;
    setName(next);
  };
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const trimmed = nameRef.current.trim();
      if (trimmed) onSubmit(trimmed);
      return;
    }
    if (key.backspace || key.delete) {
      update(nameRef.current.slice(0, -1));
      return;
    }
    if (input) update(nameRef.current + input);
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Text>New variable name:</Text>
      <Text>{name}</Text>
      <Text color="gray">enter create / esc cancel</Text>
    </Box>
  );
}
