import { describe, expect, test } from "bun:test";
import { emitBash, emitCompletions, emitZsh, walkCommands } from "../../src/cli/completions.ts";
import { memoryIo } from "../../src/cli/output.ts";
import { buildProgram } from "../../src/cli/program.ts";

const program = () => buildProgram("/tmp/unused", memoryIo());

describe("walkCommands", () => {
  test("enumerates nested noun-verb paths and long flags", () => {
    const { commands, flags } = walkCommands(program());
    expect(commands).toContain("vault add");
    expect(commands).toContain("var define");
    expect(commands).toContain("generate");
    expect(commands).toContain("completions");
    expect(flags).toContain("--vault-auth");
    expect(flags).toContain("--dry-run");
    expect(flags).toContain("--delete-files");
  });
});

describe("emit drift guard", () => {
  test("every command path and long flag appears in both scripts", () => {
    const p = program();
    const { commands, flags } = walkCommands(p);
    const zsh = emitZsh(p);
    const bash = emitBash(p);
    for (const c of commands) {
      expect(zsh).toContain(c);
      expect(bash).toContain(c);
    }
    for (const f of flags) {
      expect(zsh).toContain(f);
      expect(bash).toContain(f);
    }
  });

  test("emitCompletions dispatches by shell, rejects unknown", () => {
    expect(emitCompletions(program(), "zsh")).toContain("#compdef menv");
    expect(emitCompletions(program(), "bash")).toContain("complete -F");
    expect(() => emitCompletions(program(), "fish")).toThrow("unsupported shell");
  });
});
