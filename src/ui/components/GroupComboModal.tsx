import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { listWindow } from "./listWindow.ts";
import { TextInput } from "./TextInput.tsx";

// Default cap on visible suggestion rows; the caller (app.tsx) passes the same
// value it budgets the modal's height with so the two never disagree.
const DEFAULT_CAP = 6;

// A type-to-filter combobox for a variable's group. The text field proposes the
// existing groups beneath it; typing narrows them, ↑/↓ highlight one, and Enter
// accepts the highlighted suggestion — or, when nothing is highlighted, whatever
// was typed (so a brand-new group can be created). An empty submit clears the group.
export function GroupComboModal({ initial, groups, onSubmit, onCancel, width, suggestionRows }: {
  initial: string;
  groups: string[];
  onSubmit: (value: string) => void;
  onCancel: () => void;
  width?: number;
  suggestionRows?: number;
}) {
  const [query, setQuery] = useState(initial);
  // Index into the filtered suggestions, or -1 when the typed text is what's "active".
  const [highlight, setHighlight] = useState(-1);

  const sorted = [...groups].sort((a, b) => a.localeCompare(b));
  const q = query.trim().toLowerCase();
  const filtered = q ? sorted.filter((g) => g.toLowerCase().includes(q)) : sorted;
  const rows = suggestionRows ?? Math.min(DEFAULT_CAP, groups.length);

  const submit = (typed: string) => {
    const chosen = highlight >= 0 && filtered[highlight] !== undefined ? filtered[highlight]! : typed;
    onSubmit(chosen);
  };

  useInput((_input, key) => {
    // The text field owns everything except suggestion navigation; arrows past the
    // top return to "typing" (-1) so the typed text is what Enter would accept.
    if (key.downArrow) {
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (key.upArrow) {
      setHighlight((h) => Math.max(-1, h - 1));
    }
  });

  const windowed = rows > 0 ? listWindow(filtered, Math.max(0, highlight), rows) : { items: [], offset: 0 };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={width}>
      <Text wrap="truncate-end">Set <Text bold>group</Text></Text>
      <TextInput
        value={query}
        onChange={(v) => { setQuery(v); setHighlight(-1); }}
        onSubmit={submit}
        onCancel={onCancel}
        width={width ? width - 4 : undefined}
      />
      {/* A fixed block of `rows` suggestion lines keeps the modal's height stable as
          the filter narrows (the layout budget in app.tsx depends on it). */}
      {Array.from({ length: rows }).map((_, i) => {
        const g = windowed.items[i];
        const idx = windowed.offset + i;
        if (g === undefined) {
          // First empty slot doubles as a "new group" affordance when nothing matches.
          const showNew = i === 0 && filtered.length === 0;
          return <Text key={`s:${i}`} color="gray">{showNew ? "  — new group —" : " "}</Text>;
        }
        const selected = idx === highlight;
        return (
          <Text key={`s:${i}`} wrap="truncate-end">
            {selected ? "▸ " : "  "}
            <Text color={selected ? "cyan" : undefined}>{g}</Text>
          </Text>
        );
      })}
      <Text color="gray">↑↓ pick · ⏎ set · esc cancel · empty clears</Text>
    </Box>
  );
}
