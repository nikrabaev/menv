// Minimal dotenv parser for `menv import` — parse only (generation/serialization
// is Plan 3). Values are single-line (the v2 spec keeps v1's restriction); no
// escape-sequence processing beyond removing one layer of surrounding quotes.
export interface DotenvEntry {
  key: string;
  value: string;
}

export function parseDotenv(text: string): DotenvEntry[] {
  const out: DotenvEntry[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }
    out.push({ key, value });
  }
  return out;
}
