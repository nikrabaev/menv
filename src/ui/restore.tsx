import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { RestorePrompts } from "../cli/restore.ts";
import { inlinePrompt } from "./components/inlinePrompt.tsx";
import { listWindow } from "./components/listWindow.ts";
import { MoreIndicator } from "./components/MoreIndicator.tsx";

// "20260112223049" -> "2026-01-12 22:30:49" for a readable hint next to the key.
function readableKey(key: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(key);
  if (!m) return "";
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export function BackupSelectModal({ keys, onSelect, onCancel, height }: {
  keys: string[];
  onSelect: (key: string) => void;
  onCancel: () => void;
  height?: number;
}) {
  const [cursor, setCursor] = useState(0);
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(keys.length - 1, c + 1));
    if (key.return && keys[cursor]) onSelect(keys[cursor]);
  });
  const maxItems = height ? Math.max(1, height - 4) : keys.length;
  const windowed = listWindow(keys, cursor, maxItems);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Text>Select a backup to restore <Text color="gray">(↑/↓ move · enter select · esc cancel)</Text></Text>
      <MoreIndicator direction="up" count={windowed.offset} />
      {windowed.items.map((k, i) => {
        const idx = windowed.offset + i;
        const human = readableKey(k);
        return (
          <Text key={k} inverse={idx === cursor}>
            {k}{human ? <Text color="gray">  ({human})</Text> : null}
          </Text>
        );
      })}
      <MoreIndicator direction="down" count={keys.length - (windowed.offset + windowed.items.length)} />
    </Box>
  );
}

export function ConflictResolver({ conflicts, onDone, onCancel }: {
  conflicts: string[];
  onDone: (answers: Record<string, boolean>) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    const cur = conflicts[index];
    if (!cur) return;
    // y/n decide one file and advance; Y/N decide every remaining file at once.
    const advance = (next: Record<string, boolean>) => {
      if (index + 1 >= conflicts.length) onDone(next);
      else {
        setAnswers(next);
        setIndex(index + 1);
      }
    };
    const fillRemaining = (value: boolean) => {
      const next = { ...answers };
      for (let i = index; i < conflicts.length; i++) next[conflicts[i]] = value;
      onDone(next);
    };
    if (input === "y") advance({ ...answers, [cur]: true });
    else if (input === "n") advance({ ...answers, [cur]: false });
    else if (input === "Y") fillRemaining(true);
    else if (input === "N") fillRemaining(false);
  });
  const cur = conflicts[index];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>Restore would overwrite an existing file <Text color="gray">({index + 1}/{conflicts.length})</Text></Text>
      <Text bold>{cur}</Text>
      <Text>Replace? <Text color="gray">y yes · Y yes-all · n no · N no-all</Text></Text>
    </Box>
  );
}

export async function selectBackup(keys: string[]): Promise<string | null> {
  const rows = process.stdout.rows ?? 24;
  const height = Math.max(5, Math.min(rows - 2, keys.length + 4));
  return inlinePrompt<string | null>(
    (resolve) => (
      <BackupSelectModal keys={keys} height={height} onSelect={resolve} onCancel={() => resolve(null)} />
    ),
    null,
  );
}

export async function resolveConflicts(conflicts: string[]): Promise<Record<string, boolean> | null> {
  return inlinePrompt<Record<string, boolean> | null>(
    (resolve) => (
      <ConflictResolver conflicts={conflicts} onDone={resolve} onCancel={() => resolve(null)} />
    ),
    null,
  );
}

export const inkPrompts: RestorePrompts = { selectBackup, resolveConflicts };
