import { Box, Text } from "ink";
import { useState } from "react";
import { TextInput } from "./TextInput.tsx";

export function EditFieldModal({ label, initial, onSubmit, onCancel, width, mask }: {
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  // Full modal width; the input windows within it so the caret stays visible.
  width?: number;
  // When set, the value renders masked (secret entry) while editing the real text.
  mask?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    // The modal must stay 5 rows to hold the bottomHeight budget in app.tsx:
    // border(2) + title + field + hint. The title truncates (never wraps) so a long
    // label can't push the box taller; the field windows internally.
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width}>
      <Text wrap="truncate-end">Edit <Text bold>{label}</Text></Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        onCancel={onCancel}
        mask={mask}
        width={width ? width - 4 : undefined}
      />
      <Text color="gray">enter save / esc cancel</Text>
    </Box>
  );
}
