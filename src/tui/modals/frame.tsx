import { Box, Text } from "ink";
import type React from "react";
import { theme } from "../theme.ts";

// Shared modal chrome: a centered bordered box. Danger modals get a red frame.
export function ModalFrame({
  title,
  danger,
  width,
  children,
  hints,
}: {
  title: string;
  danger?: boolean;
  width?: number;
  children: React.ReactNode;
  hints: string;
}): React.ReactElement {
  return (
    <Box flexGrow={1} alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={danger === true ? theme.error : theme.accent}
        paddingX={2}
        paddingY={1}
        width={width ?? 64}
      >
        <Text bold color={danger === true ? theme.error : theme.accent} wrap="truncate">
          {title}
        </Text>
        {children}
        <Box marginTop={1}>
          <Text color={theme.muted} wrap="truncate">
            {hints}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
