import React, { useState } from "react";
import { Box, Text } from "ink";
import { TextInput } from "./TextInput.tsx";

export function NewVariableModal({ onSubmit, onCancel, width }: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
  width?: number;
}) {
  const [name, setName] = useState("");
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} width={width}>
      <Text>New variable name:</Text>
      <TextInput
        value={name}
        onChange={setName}
        // Ignore an empty submit, matching the old behaviour (no blank-named vars).
        onSubmit={(v) => { const trimmed = v.trim(); if (trimmed) onSubmit(trimmed); }}
        onCancel={onCancel}
        width={width ? width - 4 : undefined}
      />
      <Text color="gray">enter create / esc cancel</Text>
    </Box>
  );
}
