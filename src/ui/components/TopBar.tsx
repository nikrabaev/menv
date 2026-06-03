import { basename } from "node:path";
import { Box, Text } from "ink";

export function TopBar({ root, env, environments, dirty, unsaved }: {
  root: string;
  env: string;
  environments: string[];
  dirty: boolean;
  unsaved: number;
}) {
  return (
    <Box justifyContent="space-between" paddingX={1} borderStyle="round" borderColor="gray">
      <Text>
        <Text color="green">menv</Text> <Text color="gray">{basename(root)}</Text>
      </Text>
      {/* All environments, centered; the active one is highlighted (reverse video). */}
      <Text>
        {environments.map((id) => (
          <Text key={id} inverse={id === env} color={id === env ? "cyan" : "gray"}> {id} </Text>
        ))}
      </Text>
      <Text>
        {dirty ? <Text color="yellow">* {unsaved} unsaved</Text> : <Text color="gray">saved</Text>}
      </Text>
    </Box>
  );
}
