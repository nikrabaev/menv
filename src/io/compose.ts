import { dirname, join } from "node:path";
import { isApplied, resolveValue, varsForConsumer } from "../core/model.ts";
import type { RepoModel, Variable } from "../core/types.ts";
import { writeFileWithBackup } from "./atomicWrite.ts";
import { type SerializeEntry, serializeDotenv } from "./dotenv.ts";

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

// Resolve a marker token to a consumer id, or null (caller warns + skips). Mirrors
// cli/context.ts's resolveConsumer but returns null instead of throwing, and stays
// in the io layer (no cli import). Accepts a consumer id, an app name, or "root".
function resolveConsumerId(model: RepoModel, token: string): string | null {
  const byId = model.consumers.find((c) => c.id === token);
  if (byId) return byId.id;
  if (token === "root") {
    const r = model.consumers.find((c) => c.id === "root" || c.path === ".");
    if (r) return r.id;
  }
  const byName = model.consumers.filter((c) => c.name === token);
  return byName.length === 1 ? byName[0]!.id : null;
}

export interface SpliceResult {
  text: string;
  warnings: string[];
  refs: { consumerId: string; prefix: string }[]; // resolved consumers referenced here
}

// Rewrite every menv region in `text` for the active environment. Styles and
// consumer resolutions are computed against the pristine text, then bodies are
// spliced back-to-front so earlier line indices stay valid. Unknown-consumer
// regions are left untouched and reported in `warnings`.
export function spliceRegions(text: string, model: RepoModel, env: string): SpliceResult {
  const original = text.split("\n");
  const regions = findRegions(text);
  const plans = regions.map((region) => ({
    region,
    consumerId: resolveConsumerId(model, region.token),
    style: detectStyle(original, region),
  }));

  const lines = [...original];
  const warnings: string[] = [];
  const refs: { consumerId: string; prefix: string }[] = [];
  for (const { region, consumerId, style } of [...plans].reverse()) {
    if (!consumerId) {
      warnings.unshift(
        `menv: marker # <menv:${region.token}> names an unknown or ambiguous consumer — region left unchanged`,
      );
      continue;
    }
    const prefix = prefixFor(region.token);
    refs.unshift({ consumerId, prefix });
    const body = renderRegionBody(model, consumerId, prefix, env, style).map((l) => region.indent + l);
    lines.splice(region.open + 1, region.close - region.open - 1, ...body);
  }
  return { text: lines.join("\n"), warnings, refs };
}

const COMPOSE_GLOBS = [
  "**/docker-compose*.yml",
  "**/docker-compose*.yaml",
  "**/compose*.yml",
  "**/compose*.yaml",
];
const IGNORED_SEGMENTS = ["node_modules/", ".git/", ".menv/"];

// Repo-relative paths of every conventional compose file, excluding vendored and
// menv-internal directories. Sorted and de-duplicated across the glob families.
export async function discoverComposeFiles(root: string): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of COMPOSE_GLOBS) {
    const glob = new Bun.Glob(pattern);
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
      if (IGNORED_SEGMENTS.some((seg) => rel.includes(seg))) continue;
      found.add(rel);
    }
  }
  return [...found].sort();
}

// The `.env.compose` body for a compose-project directory: the union of the
// referenced consumers' applied values, keyed by the prefixed interpolation name.
// Keys are always prefixed, so the union never collides; sorted for stable output.
export function renderComposeEnv(
  model: RepoModel,
  refs: { consumerId: string; prefix: string }[],
  env: string,
): string {
  const byKey = new Map<string, string>();
  for (const { consumerId, prefix } of refs) {
    for (const v of composeVars(model, consumerId, env)) {
      byKey.set(`${prefix}_${v.name}`, resolveValue(model, v.id, env));
    }
  }
  const entries: SerializeEntry[] = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value, description: "" }));
  return serializeDotenv(entries);
}

// Fill every menv region across all compose files and write each compose-project
// directory's `.env.compose`. Returns the repo-relative paths actually written.
// Marker-free files are skipped; a directory whose regions resolve to no applied
// values gets no stray `.env.compose`.
export async function writeComposeFiles(model: RepoModel, env: string, stamp: string): Promise<string[]> {
  const files = await discoverComposeFiles(model.root);
  const byDir = new Map<string, string[]>();
  for (const rel of files) {
    const dir = dirname(rel);
    (byDir.get(dir) ?? byDir.set(dir, []).get(dir)!).push(rel);
  }

  const written: string[] = [];
  for (const [dir, rels] of byDir) {
    const dirRefs: { consumerId: string; prefix: string }[] = [];
    for (const rel of rels) {
      const text = await Bun.file(join(model.root, rel)).text();
      if (findRegions(text).length === 0) continue; // no markers → never touch the file
      const { text: next, warnings, refs } = spliceRegions(text, model, env);
      for (const w of warnings) console.warn(w);
      dirRefs.push(...refs);
      if (next !== text) written.push(await writeFileWithBackup(model.root, rel, next, stamp));
    }
    if (dirRefs.length === 0) continue;
    const content = renderComposeEnv(model, dirRefs, env);
    if (content.trim() === "") continue;
    // The compose YAML is committed, so it is only rewritten when changed (above);
    // .env.compose is git-ignored and disposable, so it is regenerated every run
    // like the other generated env files (generate.ts writes those unconditionally too).
    written.push(await writeFileWithBackup(model.root, join(dir, ".env.compose"), content, stamp));
  }
  return written;
}
