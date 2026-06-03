export interface DotenvEntry {
  key: string;
  value: string;
  description: string;
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
      comment.push(line.trimStart().replace(/^#\s?/, ""));
      continue;
    }
    const m = LINE.exec(line);
    if (!m) {
      comment = [];
      continue;
    }
    entries.push({ key: m[1], value: unquote(m[2]), description: comment.join(" ") });
    comment = [];
  }
  return entries;
}

export interface SerializeEntry extends DotenvEntry {
  group?: string | null;
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
    lines.push(`${e.key}=${value}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
