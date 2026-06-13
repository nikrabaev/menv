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
  roomy,
  children,
}: {
  title: string;
  focused: boolean;
  width?: number;
  flexGrow?: number;
  // When the terminal is tall enough, a blank row under the title gives the
  // content breathing room; it is dropped at the size floor so the list wins.
  roomy?: boolean;
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
      {roomy === true ? <Box height={1} /> : null}
      {children}
    </Box>
  );
}
