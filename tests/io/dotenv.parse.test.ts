import { describe, expect, test } from "bun:test";
import { parseDotenv } from "../../src/io/dotenv.ts";

describe("parseDotenv", () => {
  test("parses simple key=value", () => {
    expect(parseDotenv("FOO=bar")).toEqual([{ key: "FOO", value: "bar", description: "" }]);
  });

  test("captures a leading comment as description", () => {
    const out = parseDotenv("# the database url\nDATABASE_URL=postgres://x");
    expect(out).toEqual([{ key: "DATABASE_URL", value: "postgres://x", description: "the database url" }]);
  });

  test("blank line resets accumulated comment", () => {
    const out = parseDotenv("# stray\n\nFOO=bar");
    expect(out).toEqual([{ key: "FOO", value: "bar", description: "" }]);
  });

  test("strips surrounding double quotes and unescapes \\n", () => {
    expect(parseDotenv('KEY="a\\nb"')).toEqual([{ key: "KEY", value: "a\nb", description: "" }]);
  });

  test("keeps single-quoted value literally", () => {
    expect(parseDotenv("KEY='a\\nb'")).toEqual([{ key: "KEY", value: "a\\nb", description: "" }]);
  });

  test("ignores `export ` prefix", () => {
    expect(parseDotenv("export FOO=bar")).toEqual([{ key: "FOO", value: "bar", description: "" }]);
  });

  test("multi-line comment joins with spaces", () => {
    const out = parseDotenv("# line one\n# line two\nFOO=bar");
    expect(out[0].description).toBe("line one line two");
  });
});
