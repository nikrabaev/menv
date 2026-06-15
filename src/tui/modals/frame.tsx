import { Box, Text } from "ink";
import type React from "react";
import { useScreenSize } from "../components/screen.ts";
import { theme } from "../theme.ts";

// Shared modal chrome: a centered bordered box. Danger modals get a red frame.
// Width is adaptive — the requested width (default 64) is capped at 80% of the
// terminal so the modal never overflows on a narrow terminal.
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
  const { columns } = useScreenSize();
  const frameWidth = Math.min(width ?? 64, Math.floor(columns * 0.8));
  return (
    <Box flexGrow={1} alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={danger === true ? theme.error : theme.accent}
        paddingX={2}
        paddingY={1}
        width={frameWidth}
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
