import { expect, test } from "bun:test";
import { clipboardCommand, copyToClipboard } from "../../src/io/clipboard.ts";

test("clipboardCommand maps each platform to its tool", () => {
  expect(clipboardCommand("darwin")).toEqual(["pbcopy"]);
  expect(clipboardCommand("win32")).toEqual(["clip"]);
  expect(clipboardCommand("linux")).toEqual(["xclip", "-selection", "clipboard"]);
});

test("clipboardCommand returns null for unsupported platforms", () => {
  expect(clipboardCommand("aix" as NodeJS.Platform)).toBeNull();
});

test("copyToClipboard reports failure when no clipboard tool exists", async () => {
  expect(await copyToClipboard("hi", "aix" as NodeJS.Platform)).toBe(false);
});
