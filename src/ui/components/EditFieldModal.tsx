import React, { useRef, useState } from "react";
import { Box, Text, useInput } from "ink";

export function EditFieldModal({ label, initial, onSubmit, onCancel }: {
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(initial);
  const update = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSubmit(valueRef.current);
      return;
    }
    if (key.backspace || key.delete) {
      update(valueRef.current.slice(0, -1));
      return;
    }
    if (input) update(valueRef.current + input);
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {/* truncate (never wrap): the modal must stay 5 rows to hold the bottomHeight
          budget in app.tsx. The value shows its tail (truncate-start) so the chars
          being typed at the end stay visible on a narrow terminal. */}
      <Text wrap="truncate-end">Edit <Text bold>{label}</Text></Text>
      <Text wrap="truncate-start">{value}</Text>
      <Text color="gray">enter save / esc cancel</Text>
    </Box>
  );
}
