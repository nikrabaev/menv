import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { inlinePrompt } from "./components/inlinePrompt.tsx";
import type { FileDrift } from "../io/drift.ts";

function clip(v: string, width = 40): string {
  if (v.length <= width) return v;
  return v.slice(0, width - 1) + "…";
}

// Walks the drifted files one at a time (mirroring restore.tsx's ConflictResolver
// idiom): per file the user chooses to import its on-disk edits into the vault or
// keep the vault as-is. Resolves the set of file paths to import. `esc` keeps all.
export function DriftReconciler({ drifts, onDone, onCancel }: {
  drifts: FileDrift[];
  onDone: (importRels: Set<string>) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});

  const toSet = (rec: Record<string, boolean>) =>
    new Set(Object.entries(rec).filter(([, v]) => v).map(([rel]) => rel));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    const cur = drifts[index];
    if (!cur) return;
    // y/n decide one file and advance; Y/N decide every remaining file at once.
    const advance = (next: Record<string, boolean>) => {
      if (index + 1 >= drifts.length) onDone(toSet(next));
      else {
        setAnswers(next);
        setIndex(index + 1);
      }
    };
    const fillRemaining = (value: boolean) => {
      const next = { ...answers };
      for (let i = index; i < drifts.length; i++) next[drifts[i]!.rel] = value;
      onDone(toSet(next));
    };
    if (input === "y") advance({ ...answers, [cur.rel]: true });
    else if (input === "n") advance({ ...answers, [cur.rel]: false });
    else if (input === "Y") fillRemaining(true);
    else if (input === "N") fillRemaining(false);
  });

  const cur = drifts[index];
  if (!cur) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>
        A generated file was edited by hand <Text color="gray">({index + 1}/{drifts.length})</Text>
      </Text>
      <Text bold>{cur.rel}</Text>
      {cur.changed.map((c) => (
        <Text key={`c:${c.name}`}>
          <Text color="yellow">~ {c.name}</Text>
          <Text color="gray">  {clip(c.expected)} → </Text>
          <Text>{clip(c.actual)}</Text>
        </Text>
      ))}
      {cur.added.map((a) => (
        <Text key={`a:${a.name}`}>
          <Text color="green">+ {a.name}</Text>
          <Text color="gray">  {clip(a.value)}</Text>
          <Text color="gray"> (new variable)</Text>
        </Text>
      ))}
      {cur.removed.map((r) => (
        <Text key={`r:${r.name}`}>
          <Text color="red">- {r.name}</Text>
          <Text color="gray">  (kept in vault)</Text>
        </Text>
      ))}
      <Text>
        Import these edits into the vault?{" "}
        <Text color="gray">y yes · Y yes-all · n keep vault · N keep-all · esc skip</Text>
      </Text>
    </Box>
  );
}

export async function reconcileDrift(drifts: FileDrift[]): Promise<Set<string> | null> {
  return inlinePrompt<Set<string> | null>(
    (resolve) => (
      <DriftReconciler drifts={drifts} onDone={resolve} onCancel={() => resolve(null)} />
    ),
    null,
  );
}
