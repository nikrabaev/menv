import { expect, test } from "bun:test";
import { clipboardCommands, copyToClipboard } from "../../src/io/clipboard.ts";

test("clipboardCommands lists the tools to try per platform", () => {
  expect(clipboardCommands("darwin")).toEqual([["pbcopy"]]);
  expect(clipboardCommands("win32")).toEqual([["clip"]]);
  expect(clipboardCommands("linux")).toEqual([["wl-copy"], ["xclip", "-selection", "clipboard"]]);
});

test("clipboardCommands returns no candidates for unsupported platforms", () => {
  expect(clipboardCommands("aix" as NodeJS.Platform)).toEqual([]);
});

test("copyToClipboard reports failure when no clipboard tool exists", async () => {
  expect(await copyToClipboard("hi", "aix" as NodeJS.Platform)).toBe(false);
});
