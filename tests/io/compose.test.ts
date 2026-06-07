import { expect, test } from "bun:test";
import { findRegions, prefixFor } from "../../src/io/compose.ts";

test("findRegions captures token, indent, and line span", () => {
  const text = [
    "services:",
    "  api:",
    "    environment:",
    "      - NODE_ENV=production",
    "      # <menv:api>",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture
    "      - OLD=${API_OLD}",
    "      # </menv>",
  ].join("\n");
  const regions = findRegions(text);
  expect(regions).toHaveLength(1);
  expect(regions[0]!.token).toBe("api");
  expect(regions[0]!.indent).toBe("      ");
  expect(regions[0]!.open).toBe(4);
  expect(regions[0]!.close).toBe(6);
});

test("findRegions ignores an unterminated open marker", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional fixture
  const text = ["    # <menv:api>", "    - X=${API_X}"].join("\n");
  expect(findRegions(text)).toEqual([]);
});

test("findRegions tolerates an echoed name on the close tag and finds multiple regions", () => {
  const text = [
    "    # <menv:api>",
    "    # </menv:api>",
    "    # <menv:web>",
    "    # </menv>",
  ].join("\n");
  expect(findRegions(text).map((r) => r.token)).toEqual(["api", "web"]);
});

test("prefixFor uppercases and normalizes non-alphanumerics", () => {
  expect(prefixFor("api")).toBe("API");
  expect(prefixFor("web-admin")).toBe("WEB_ADMIN");
  expect(prefixFor("@acme/api")).toBe("ACME_API");
  expect(prefixFor("root")).toBe("ROOT");
});
