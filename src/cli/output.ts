import { MenvError } from "../core/errors.ts";

export type OutputMode = "pretty" | "json";

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const processIo: Io = {
  stdout: (s) => void process.stdout.write(s),
  stderr: (s) => void process.stderr.write(s),
};

// Test double: collects writes instead of printing.
export function memoryIo(): Io & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) };
}

export function resolveMode(flag: string | undefined, env: Record<string, string | undefined>): OutputMode {
  const m = flag ?? env.MENV_OUTPUT ?? "pretty";
  if (m !== "pretty" && m !== "json") {
    throw new MenvError("VALIDATION", `invalid output mode "${m}" (pretty | json)`);
  }
  return m;
}

// The uniform envelope (spec: output-modes contract). Success → stdout in both
// modes; errors → stdout as an envelope in json (machine-readable stream) but
// stderr in pretty (keeps $(menv get …) pipelines clean).
export function emitResult(io: Io, mode: OutputMode, result: unknown, pretty: string): void {
  if (mode === "json") {
    io.stdout(`${JSON.stringify({ ok: true, result })}\n`);
    return;
  }
  io.stdout(pretty.endsWith("\n") ? pretty : `${pretty}\n`);
}

export function emitError(io: Io, mode: OutputMode, e: MenvError): void {
  if (mode === "json") {
    io.stdout(`${JSON.stringify({ ok: false, error: { code: e.code, message: e.message, details: e.details ?? null } })}\n`);
    return;
  }
  io.stderr(`menv: ${e.message}\n`);
}

// For the top-level error handler: the parse may have failed, so sniff the raw
// argv instead of trusting commander. Unknown values fall back to pretty.
export function peekJsonMode(argv: string[], env: Record<string, string | undefined>): OutputMode {
  const i = argv.indexOf("--output");
  const fromArgv = i !== -1 ? argv[i + 1] : argv.find((a) => a.startsWith("--output="))?.slice("--output=".length);
  const m = fromArgv ?? env.MENV_OUTPUT;
  return m === "json" ? "json" : "pretty";
}
