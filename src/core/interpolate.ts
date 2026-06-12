import { MenvError } from "./errors.ts";

// ${NAME} interpolation (spec: "Interpolation & globals"). Hybrid model:
// variable refs and static globals expand at generate time; runtime globals
// are emitted literally for the platform to resolve. "$${" escapes "${".

export type Segment = { kind: "text"; text: string } | { kind: "ref"; name: string };

export type GlobalResolution = { kind: "static"; value: string } | { kind: "runtime" };

const REF_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function tokenize(raw: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith("$${", i)) {
      text += "${";
      i += 3;
      continue;
    }
    if (raw.startsWith("${", i)) {
      const end = raw.indexOf("}", i + 2);
      const name = end === -1 ? null : raw.slice(i + 2, end);
      if (name !== null && REF_NAME_RE.test(name)) {
        if (text !== "") {
          out.push({ kind: "text", text });
          text = "";
        }
        out.push({ kind: "ref", name });
        i = end + 1;
        continue;
      }
      // Unterminated or not a legal name: keep it literal rather than guess.
    }
    text += raw[i];
    i += 1;
  }
  if (text !== "") out.push({ kind: "text", text });
  return out;
}

export function extractRefs(raw: string): string[] {
  return tokenize(raw).flatMap((s) => (s.kind === "ref" ? [s.name] : []));
}

export interface ExpandInput {
  // Variable name → raw value, for ONE (vault, consumer) scope.
  values: ReadonlyMap<string, string>;
  // Global name → how it resolves in this vault.
  globals: ReadonlyMap<string, GlobalResolution>;
}

// Expands every value. Throws VALIDATION on an unresolvable ref or a cycle —
// callers (generate) must treat that as "write nothing".
export function expandAll(input: ExpandInput): Map<string, string> {
  const done = new Map<string, string>();
  const visiting: string[] = [];

  const resolve = (name: string): string => {
    const memo = done.get(name);
    if (memo !== undefined) return memo;
    const cycleStart = visiting.indexOf(name);
    if (cycleStart !== -1) {
      const chain = [...visiting.slice(cycleStart), name].join(" → ");
      throw new MenvError("VALIDATION", `interpolation cycle: ${chain}`);
    }
    // biome-ignore lint/style/noNonNullAssertion: only called for known names
    const raw = input.values.get(name)!;
    visiting.push(name);
    let result = "";
    for (const seg of tokenize(raw)) {
      if (seg.kind === "text") {
        result += seg.text;
        continue;
      }
      if (input.values.has(seg.name)) {
        result += resolve(seg.name);
        continue;
      }
      const g = input.globals.get(seg.name);
      if (g === undefined) {
        throw new MenvError(
          "VALIDATION",
          `\${${seg.name}} in ${name} does not resolve to a variable or global in this scope`,
        );
      }
      result += g.kind === "static" ? g.value : `\${${seg.name}}`;
    }
    visiting.pop();
    done.set(name, result);
    return result;
  };

  for (const name of input.values.keys()) resolve(name);
  return done;
}
