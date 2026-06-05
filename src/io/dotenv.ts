export interface DotenvEntry {
  key: string;
  value: string;
  description: string;
  // false ⇒ the line is commented out on disk (`# KEY=value`): the variable is
  // wired to the consumer but not *applied* in this file. true ⇒ a live assignment.
  active: boolean;
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"');
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  // strip trailing inline comment for unquoted values
  const hash = v.indexOf(" #");
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

export function parseDotenv(text: string): DotenvEntry[] {
  const entries: DotenvEntry[] = [];
  let comment: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      comment = [];
      continue;
    }
    if (line.trimStart().startsWith("#")) {
      const body = line.trimStart().replace(/^#\s?/, "");
      // Group-header banner (`# ─── group ───`): structural, not prose — ignore it
      // so it neither becomes a description nor looks like a commented var.
      if (body.startsWith("─")) continue;
      // A comment whose body parses as an assignment is a commented-out (inactive)
      // variable, not free-form description text.
      const dm = LINE.exec(body);
      if (dm) {
        entries.push({ key: dm[1], value: unquote(dm[2]), description: comment.join(" "), active: false });
        comment = [];
        continue;
      }
      comment.push(body);
      continue;
    }
    const m = LINE.exec(line);
    if (!m) {
      comment = [];
      continue;
    }
    entries.push({ key: m[1], value: unquote(m[2]), description: comment.join(" "), active: true });
    comment = [];
  }
  return entries;
}

export interface SerializeEntry extends Omit<DotenvEntry, "active"> {
  group?: string | null;
  active?: boolean; // absent ⇒ true (a live assignment); false ⇒ commented out
}

export interface SerializeOpts {
  valuesFree?: boolean; // emit KEY= with no value (for .env.example)
  groupHeaders?: boolean; // emit "# ─── group ───" banners
}

function needsQuote(v: string): boolean {
  return /[\s"'#=]/.test(v) || v.includes("\n");
}

function quote(v: string): string {
  if (!needsQuote(v)) return v;
  return `"${v.replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
}

export function serializeDotenv(entries: SerializeEntry[], opts: SerializeOpts = {}): string {
  const lines: string[] = [];
  let lastGroup: string | null | undefined ;
  for (const e of entries) {
    if (opts.groupHeaders && e.group !== lastGroup) {
      if (e.group) lines.push(`# ─── ${e.group} ───`);
      lastGroup = e.group;
    }
    if (e.description) lines.push(`# ${e.description}`);
    const value = opts.valuesFree ? "" : quote(e.value);
    const assignment = `${e.key}=${value}`;
    // A wired-but-not-applied variable is emitted commented out so it round-trips
    // back to an inactive entry on the next parse.
    lines.push(e.active === false ? `# ${assignment}` : assignment);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
