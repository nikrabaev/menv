const OPEN = /^(\s*)#\s*<menv:([^>]+)>\s*$/;
const CLOSE = /^\s*#\s*<\/menv(?::[^>]+)?>\s*$/;

export interface Region {
  token: string; // consumer token from the open marker
  indent: string; // leading whitespace of the open-marker line; reused for the body
  open: number; // line index of the open marker
  close: number; // line index of the close marker
}

// Find every `# <menv:NAME>` … `# </menv>` region. Regions do not nest; each open
// pairs with the nearest following close. An unterminated open is ignored.
export function findRegions(text: string): Region[] {
  const lines = text.split("\n");
  const regions: Region[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]!);
    if (!m) continue;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (CLOSE.test(lines[j]!)) {
        close = j;
        break;
      }
    }
    if (close === -1) continue;
    regions.push({ token: m[2]!.trim(), indent: m[1]!, open: i, close });
    i = close;
  }
  return regions;
}

// Derive the interpolation-key prefix for a consumer token: uppercased, every run
// of non-[A-Z0-9_] collapsed to a single "_", and leading/trailing "_" trimmed.
export function prefixFor(token: string): string {
  return token.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}
