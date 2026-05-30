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
