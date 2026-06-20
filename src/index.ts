#!/usr/bin/env bun
import { emitError, peekJsonMode, processIo } from "./cli/output.ts";
import { buildProgram } from "./cli/program.ts";
import { MenvError } from "./core/errors.ts";
import { findRoot } from "./io/root.ts";

const argv = process.argv.slice(2);
const root = (await findRoot(process.cwd())) ?? process.cwd();
const program = buildProgram(root, processIo);
program.exitOverride(); // commander errors become catchable; we own the exit codes

if (argv.length === 0) {
  program.outputHelp();
  process.exit(0);
}

try {
  await program.parseAsync(argv, { from: "user" });
  process.exit(0);
} catch (e) {
  if (e instanceof MenvError) {
    emitError(processIo, peekJsonMode(argv, process.env), e);
    process.exit(e.exitCode);
  }
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && code.startsWith("commander.")) {
    // help/version are success; everything else commander raises is usage (exit 2)
    if (code === "commander.helpDisplayed" || code === "commander.help" || code === "commander.version") {
      process.exit(0);
    }
    process.exit(2); // commander already printed the message + suggestion
  }
  processIo.stderr(`menv: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
