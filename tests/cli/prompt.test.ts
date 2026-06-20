import { describe, expect, test } from "bun:test";
import { readValue, stripTrailingNewline } from "../../src/cli/prompt.ts";

describe("readValue", () => {
  test("an explicit argument wins, even empty string", async () => {
    expect(await readValue("v", { isTTY: true, readStdin: async () => "x", prompt: async () => "y" })).toBe("v");
    expect(await readValue("", { isTTY: true, readStdin: async () => "x", prompt: async () => "y" })).toBe("");
  });

  test("no arg + piped stdin → stdin with one trailing newline stripped", async () => {
    const deps = { isTTY: false, readStdin: async () => "secret-value\n", prompt: async () => "y" };
    expect(await readValue(undefined, deps)).toBe("secret-value");
  });

  test("no arg + TTY → masked prompt", async () => {
    const deps = { isTTY: true, readStdin: async () => "x", prompt: async () => "typed" };
    expect(await readValue(undefined, deps)).toBe("typed");
  });
});

describe("stripTrailingNewline", () => {
  test("strips exactly one trailing newline (and CRLF)", () => {
    expect(stripTrailingNewline("a\n")).toBe("a");
    expect(stripTrailingNewline("a\r\n")).toBe("a");
    expect(stripTrailingNewline("a\n\n")).toBe("a\n");
    expect(stripTrailingNewline("a")).toBe("a");
  });
});
