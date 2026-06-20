import { describe, expect, test } from "bun:test";
import { parseDotenv } from "../../src/io/dotenv.ts";

describe("parseDotenv", () => {
  test("parses KEY=VALUE lines, skipping comments and blanks", () => {
    expect(parseDotenv("# c\n\nA=1\nB=two words\n")).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "two words" },
    ]);
  });

  test("strips export prefix and surrounding quotes", () => {
    expect(parseDotenv("export A='quoted'\nB=\"d q\"\n")).toEqual([
      { key: "A", value: "quoted" },
      { key: "B", value: "d q" },
    ]);
  });

  test("trailing inline comment is stripped from unquoted values only", () => {
    expect(parseDotenv("A=v # note\nB=\"v # not a comment\"\n")).toEqual([
      { key: "A", value: "v" },
      { key: "B", value: "v # not a comment" },
    ]);
  });

  test("empty value and = inside value", () => {
    expect(parseDotenv("A=\nB=a=b\n")).toEqual([
      { key: "A", value: "" },
      { key: "B", value: "a=b" },
    ]);
  });

  test("lines without = are ignored", () => {
    expect(parseDotenv("garbage line\nA=1\n")).toEqual([{ key: "A", value: "1" }]);
  });
});
