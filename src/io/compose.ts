import { isApplied, varsForConsumer } from "../core/model.ts";
import type { RepoModel, Variable } from "../core/types.ts";

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

const indentLen = (s: string) => /^\s*/.exec(s)![0]!.length;

// Classify a single line as a YAML sequence item, a mapping entry, or neither
// (blank/comment). Used to infer the style of the block a region sits in.
function classifyEntry(line: string): "seq" | "map" | null {
  const t = line.trimStart();
  if (t === "" || t.startsWith("#")) return null;
  if (t === "-" || t.startsWith("- ")) return "seq";
  if (/^[A-Za-z_][\w.-]*\s*:/.test(t)) return "map";
  return null;
}

// Infer whether the region's environment block is a sequence or a mapping: first
// from any entry already inside the region, then from the nearest sibling at the
// marker's indentation (scanning up, then down, stopping at a lower indent — i.e.
// the block boundary). Defaults to "seq" for an otherwise-empty block.
export function detectStyle(lines: string[], region: Region): "seq" | "map" {
  for (let i = region.open + 1; i < region.close; i++) {
    const c = classifyEntry(lines[i]!);
    if (c) return c;
  }
  const want = region.indent.length;
  const scan = (from: number, step: number, stop: (i: number) => boolean): "seq" | "map" | null => {
    for (let i = from; !stop(i); i += step) {
      const line = lines[i]!;
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      if (indentLen(line) < want) break; // left the environment block
      if (indentLen(line) === want) {
        const c = classifyEntry(line);
        if (c) return c;
      }
    }
    return null;
  };
  return scan(region.open - 1, -1, (i) => i < 0) ?? scan(region.close + 1, 1, (i) => i >= lines.length) ?? "seq";
}

// The base variables wired to `consumerId` and applied in `env`, group-then-name
// sorted. Null groups sort last (sentinel "￿" sorts after all real group names).
// Local (.env.local) overrides never appear in a compose region.
function composeVars(model: RepoModel, consumerId: string, env: string): Variable[] {
  return varsForConsumer(model, consumerId)
    .filter((v) => !(v.local ?? false) && isApplied(v, consumerId, env))
    .sort((a, b) => {
      const ga = a.group ?? "￿";
      const gb = b.group ?? "￿";
      if (ga < gb) return -1;
      if (ga > gb) return 1;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
}

// The body lines for a region (no indentation; the splicer adds it). The container
// variable name stays on the left; the interpolation key is the prefixed name.
export function renderRegionBody(
  model: RepoModel,
  consumerId: string,
  prefix: string,
  env: string,
  style: "seq" | "map",
): string[] {
  return composeVars(model, consumerId, env).map((v) =>
    style === "map" ? `${v.name}: \${${prefix}_${v.name}}` : `- ${v.name}=\${${prefix}_${v.name}}`,
  );
}
