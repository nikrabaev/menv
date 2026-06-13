import { Box, Text } from "ink";
import type React from "react";
import { theme } from "../theme.ts";

// A bordered panel with an in-border title. Focus is encoded twice (border
// color + bold title) so it survives monochrome.
export function Pane({
  title,
  focused,
  width,
  flexGrow,
  children,
}: {
  title: string;
  focused: boolean;
  width?: number;
  flexGrow?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? theme.accent : theme.muted}
      width={width}
      flexGrow={flexGrow}
      paddingX={1}
      overflow="hidden"
    >
      <Text bold={focused} color={focused ? theme.accent : theme.muted}>
        {title}
      </Text>
      {children}
    </Box>
  );
}
