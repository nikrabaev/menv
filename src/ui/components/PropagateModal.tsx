import { Box, Text } from "ink";

// A static yes/no prompt shown after editing a value that several environments
// shared: it offers to push the new value to those environments too. Lists env
// names only (never the value), so secrets stay hidden. Keyboard is handled by
// the parent (app.tsx) alongside the other confirm prompts; this only renders.
export function PropagateModal({ varName, sharedEnvs, cap = 6, width }: {
  varName: string;
  sharedEnvs: string[];
  cap?: number;
  width?: number;
}) {
  const shown = sharedEnvs.slice(0, cap);
  const extra = sharedEnvs.length - shown.length;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={width}>
      <Text wrap="truncate-end">
        <Text bold>{varName}</Text> has this value in {sharedEnvs.length} other
        {sharedEnvs.length === 1 ? " environment" : " environments"} — update them too?
      </Text>
      {shown.map((e) => (
        <Text key={e}>  {e}</Text>
      ))}
      {extra > 0 ? <Text color="gray">  +{extra} more</Text> : null}
      <Text color="gray">y yes · n/enter no · esc cancel</Text>
    </Box>
  );
}
