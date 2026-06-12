import { describe, expect, test } from "bun:test";
import {
  disclaimerHeader,
  hasOwnershipMarker,
  headerVault,
  OWNERSHIP_MARKER,
  stripDisclaimer,
} from "../../src/generate/ownership.ts";

describe("disclaimerHeader", () => {
  test("is exactly three comment lines + one blank, starting with the marker", () => {
    const h = disclaimerHeader({ vault: "local", consumer: "api" });
    const lines = h.split("\n");
    expect(lines[0]?.startsWith(OWNERSHIP_MARKER)).toBe(true);
    expect(lines[1]).toContain("vault: local");
    expect(lines[1]).toContain("consumer: api");
    expect(lines[2]).toContain("menv generate");
    expect(lines[3]).toBe("");
    expect(lines).toHaveLength(4); // header ends with the blank separator
  });

  test("origin parts are optional", () => {
    expect(disclaimerHeader({}).split("\n")[1]).toBe("# Generated from menv.json");
  });
});

describe("hasOwnershipMarker / stripDisclaimer", () => {
  const body = "# ── Database ──\nDATABASE_URL=x\n";
  const owned = `${disclaimerHeader({ vault: "local", consumer: "api" })}\n${body}`;

  test("detects the marker only on the first line", () => {
    expect(hasOwnershipMarker(owned)).toBe(true);
    expect(hasOwnershipMarker(body)).toBe(false);
    expect(hasOwnershipMarker(`\n${owned}`)).toBe(false);
  });

  test("strip removes exactly the header, keeping group comments intact", () => {
    expect(stripDisclaimer(owned)).toBe(body);
    expect(stripDisclaimer(body)).toBe(body); // no marker → unchanged
  });
});

describe("headerVault", () => {
  test("reads the vault recorded in the header; undefined when absent", () => {
    expect(headerVault(disclaimerHeader({ vault: "production", consumer: "api" }))).toBe("production");
    expect(headerVault(disclaimerHeader({ consumer: "api" }))).toBeUndefined();
    expect(headerVault("FOO=bar\n")).toBeUndefined();
  });
});
