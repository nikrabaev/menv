import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../src/core/errors.ts";
import type { GlobalResolution } from "../../src/core/interpolate.ts";
import { expandAll, extractRefs, tokenize } from "../../src/core/interpolate.ts";

const globals = (entries: Record<string, GlobalResolution>) => new Map(Object.entries(entries));
const values = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("tokenize / extractRefs", () => {
  test("splits text and refs", () => {
    expect(tokenize("https://${HOST}/api")).toEqual([
      { kind: "text", text: "https://" },
      { kind: "ref", name: "HOST" },
      { kind: "text", text: "/api" },
    ]);
    expect(extractRefs("${A}-${B}")).toEqual(["A", "B"]);
  });

  test("$${ escapes a literal ${", () => {
    expect(tokenize("cost: $${PRICE}")).toEqual([{ kind: "text", text: "cost: ${PRICE}" }]);
    expect(extractRefs("$${NOT_A_REF}")).toEqual([]);
  });

  test("invalid or unterminated references stay literal text", () => {
    expect(tokenize("${1bad} ${unclosed")).toEqual([{ kind: "text", text: "${1bad} ${unclosed" }]);
  });

  test("an empty reference ${} stays literal text", () => {
    expect(tokenize("a${}b")).toEqual([{ kind: "text", text: "a${}b" }]);
    expect(extractRefs("${}")).toEqual([]);
  });
});

describe("expandAll", () => {
  test("expands variable refs and chains", () => {
    const out = expandAll({
      values: values({ HOST: "localhost", URL: "https://${HOST}/api", HEALTH: "${URL}/health" }),
      globals: globals({}),
    });
    expect(out.get("HEALTH")).toBe("https://localhost/api/health");
  });

  test("static global substitutes; runtime global passes through literally", () => {
    const out = expandAll({
      values: values({ A: "${STATIC_G}/${RUNTIME_G}" }),
      globals: globals({ STATIC_G: { kind: "static", value: "s" }, RUNTIME_G: { kind: "runtime" } }),
    });
    expect(out.get("A")).toBe("s/${RUNTIME_G}");
  });

  test("variables shadow nothing: a name that is both variable and global resolves as variable", () => {
    const out = expandAll({
      values: values({ NAME: "var-wins", A: "${NAME}" }),
      globals: globals({ NAME: { kind: "static", value: "global-loses" } }),
    });
    expect(out.get("A")).toBe("var-wins");
  });

  test("unresolvable reference → VALIDATION naming both sides", () => {
    try {
      expandAll({ values: values({ A: "${GHOST}" }), globals: globals({}) });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect((e as MenvError).message).toContain("GHOST");
      expect((e as MenvError).message).toContain("A");
    }
  });

  test("cycle → VALIDATION showing the chain", () => {
    try {
      expandAll({ values: values({ A: "${B}", B: "${A}" }), globals: globals({}) });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect((e as MenvError).message).toContain("cycle");
    }
  });

  test("a single-node self-reference (A=${A}) is detected as a cycle", () => {
    try {
      expandAll({ values: values({ A: "${A}" }), globals: globals({}) });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect((e as MenvError).message).toContain("cycle");
    }
  });
});
