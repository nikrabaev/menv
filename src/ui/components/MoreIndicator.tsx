import React from "react";
import { Text } from "ink";

// Replaces the bare "..." overflow marker with a count of how many list items
// are hidden in that direction. Renders nothing when none are hidden, so it can
// stand in for the old `offset > 0 && ...` / `... < total` conditionals.
export function MoreIndicator({ count, direction }: { count: number; direction: "up" | "down" }) {
  if (count <= 0) return null;
  const arrow = direction === "up" ? "↑" : "↓";
  return <Text color="gray">{`  ${arrow} ${count} more`}</Text>;
}
