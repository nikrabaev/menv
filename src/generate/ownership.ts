// The ownership rule (spec req 5): menv only overwrites or deletes a file
// whose FIRST line carries this marker. The header is structurally fixed —
// marker line, origin line, advice line, blank — so stripDisclaimer can remove
// exactly the header without eating the body's own comments (group headers).
export const OWNERSHIP_MARKER = "# ── managed by menv ─ DO NOT EDIT ─";
const HEADER_COMMENT_LINES = 3;

export interface HeaderMeta {
  vault?: string;
  consumer?: string;
}

export function disclaimerHeader(meta: HeaderMeta): string {
  const origin = [
    meta.vault !== undefined ? `vault: ${meta.vault}` : null,
    meta.consumer !== undefined ? `consumer: ${meta.consumer}` : null,
  ]
    .filter((p) => p !== null)
    .join(" · ");
  return [
    `${OWNERSHIP_MARKER}───────────────────────────`,
    `# Generated from menv.json${origin === "" ? "" : ` · ${origin}`}`,
    "# Re-create with `menv generate`; your edits will be overwritten.",
    "",
  ].join("\n");
}

export function hasOwnershipMarker(content: string): boolean {
  return content.startsWith(OWNERSHIP_MARKER);
}

// Removes exactly the header block (3 comment lines + the blank separator).
export function stripDisclaimer(content: string): string {
  if (!hasOwnershipMarker(content)) return content;
  const lines = content.split("\n");
  let i = HEADER_COMMENT_LINES;
  if (lines[i] === "") i += 1;
  return lines.slice(i).join("\n");
}

// Which vault a generated file was rendered from — `check` judges staleness
// against THIS vault, so generating --vault production doesn't flag the file
// as stale relative to the default vault.
export function headerVault(content: string): string | undefined {
  if (!hasOwnershipMarker(content)) return undefined;
  const origin = content.split("\n")[1] ?? "";
  const m = origin.match(/vault: ([^\s·]+)/);
  return m?.[1];
}
