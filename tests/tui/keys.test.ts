// The keymap is the single source for the footer and the help overlay — keep
// the two derivations honest.
import { describe, expect, test } from "bun:test";
import type { KeyContext } from "../../src/tui/keys.ts";
import { contextHints, footerHints, HELP_SECTIONS, KEYMAP } from "../../src/tui/keys.ts";

describe("keymap", () => {
  test("every context is reachable from the help overlay", () => {
    const covered = new Set(HELP_SECTIONS.map((s) => s.context));
    for (const context of Object.keys(KEYMAP) as KeyContext[]) {
      expect(covered.has(context)).toBe(true);
    }
  });

  test("footer shows at most 8 hints and always ends with help + quit", () => {
    for (const context of Object.keys(KEYMAP) as KeyContext[]) {
      const hints = footerHints(context);
      expect(hints.length).toBeLessThanOrEqual(8);
      expect(hints.at(-2)?.key).toBe("?");
      expect(hints.at(-1)?.key).toBe("q");
    }
  });

  test("universal conventions stay bound", () => {
    const global = KEYMAP.global.map((h) => h.key).join(" ");
    expect(global).toContain("q");
    expect(global).toContain("?");
    expect(global).toContain("/");
  });
});

describe("reveal suppresses the peek hint", () => {
  test("contextHints drops r when secrets are revealed", () => {
    expect(contextHints("inspector", true).some((h) => h.key === "r")).toBe(false);
    expect(contextHints("inspector", false).some((h) => h.key === "r")).toBe(true);
    expect(contextHints("variables", true).some((h) => h.key === "r")).toBe(false);
  });

  test("footerHints honors the reveal flag", () => {
    expect(footerHints("inspector", true).some((h) => h.key === "r")).toBe(false);
    expect(footerHints("inspector").some((h) => h.key === "r")).toBe(true);
  });

  test("ctrl+r is registered as a global chord", () => {
    expect(KEYMAP.global.some((h) => h.key === "^r")).toBe(true);
  });
});
