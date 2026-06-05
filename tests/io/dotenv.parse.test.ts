import { describe, expect, test } from "bun:test";
import { parseDotenv } from "../../src/io/dotenv.ts";

describe("parseDotenv", () => {
  test("parses simple key=value", () => {
    expect(parseDotenv("FOO=bar")).toEqual([{ key: "FOO", value: "bar", description: "", active: true }]);
  });

  test("captures a leading comment as description", () => {
    const out = parseDotenv("# the database url\nDATABASE_URL=postgres://x");
    expect(out).toEqual([{ key: "DATABASE_URL", value: "postgres://x", description: "the database url", active: true }]);
  });

  test("blank line resets accumulated comment", () => {
    const out = parseDotenv("# stray\n\nFOO=bar");
    expect(out).toEqual([{ key: "FOO", value: "bar", description: "", active: true }]);
  });

  test("strips surrounding double quotes and unescapes \\n", () => {
    expect(parseDotenv('KEY="a\\nb"')).toEqual([{ key: "KEY", value: "a\nb", description: "", active: true }]);
  });

  test("keeps single-quoted value literally", () => {
    expect(parseDotenv("KEY='a\\nb'")).toEqual([{ key: "KEY", value: "a\\nb", description: "", active: true }]);
  });

  test("ignores `export ` prefix", () => {
    expect(parseDotenv("export FOO=bar")).toEqual([{ key: "FOO", value: "bar", description: "", active: true }]);
  });

  test("multi-line comment joins with spaces", () => {
    const out = parseDotenv("# line one\n# line two\nFOO=bar");
    expect(out[0].description).toBe("line one line two");
  });

  // --- commented-out variables ("wired but not applied") ---

  test("parses a commented-out var as an inactive entry", () => {
    expect(parseDotenv("# FOO=bar")).toEqual([{ key: "FOO", value: "bar", description: "", active: false }]);
  });

  test("recognises a commented var with no space after the hash", () => {
    expect(parseDotenv("#FOO=bar")).toEqual([{ key: "FOO", value: "bar", description: "", active: false }]);
  });

  test("a commented var carries its preceding description", () => {
    const out = parseDotenv("# the db url\n# DATABASE_URL=postgres://x");
    expect(out).toEqual([{ key: "DATABASE_URL", value: "postgres://x", description: "the db url", active: false }]);
  });

  test("prose that is not an assignment stays a description", () => {
    const out = parseDotenv("# just some prose\nFOO=bar");
    expect(out).toEqual([{ key: "FOO", value: "bar", description: "just some prose", active: true }]);
  });

  test("multi-word prose containing an = is not misread as a var", () => {
    const out = parseDotenv("# set TIMEOUT=30 here\nFOO=bar");
    expect(out).toEqual([{ key: "FOO", value: "bar", description: "set TIMEOUT=30 here", active: true }]);
  });

  test("skips a group-header banner instead of treating it as a description", () => {
    const out = parseDotenv("# ─── DB ───\nFOO=bar");
    expect(out).toEqual([{ key: "FOO", value: "bar", description: "", active: true }]);
  });

  test("returns both a commented and an active line for the same key, in order", () => {
    const out = parseDotenv("# FOO=old\nFOO=new");
    expect(out).toEqual([
      { key: "FOO", value: "old", description: "", active: false },
      { key: "FOO", value: "new", description: "", active: true },
    ]);
  });
});
