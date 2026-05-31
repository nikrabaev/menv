import { expect, test } from "bun:test";
import { HELP_TEXT } from "../../src/cli/help.ts";

test("HELP_TEXT documents every command and the restore flags", () => {
  for (const token of ["init", "generate", "--env", "backup", "restore", "-f", "--force", "--help", "--version"]) {
    expect(HELP_TEXT).toContain(token);
  }
});
