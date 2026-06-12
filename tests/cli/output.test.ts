import { describe, expect, test } from "bun:test";
import { emitError, emitResult, memoryIo, peekJsonMode, resolveMode } from "../../src/cli/output.ts";
import { MenvError } from "../../src/core/errors.ts";

describe("resolveMode", () => {
  test("flag > env > pretty default; invalid value → VALIDATION", () => {
    expect(resolveMode("json", {})).toBe("json");
    expect(resolveMode(undefined, { MENV_OUTPUT: "json" })).toBe("json");
    expect(resolveMode(undefined, {})).toBe("pretty");
    expect(resolveMode("pretty", { MENV_OUTPUT: "json" })).toBe("pretty");
    expect(() => resolveMode("xml", {})).toThrow("invalid output mode");
  });
});

describe("emitResult / emitError", () => {
  test("json mode wraps in the ok envelope on stdout", () => {
    const io = memoryIo();
    emitResult(io, "json", { applied: true }, "applied");
    expect(JSON.parse(io.out.join(""))).toEqual({ ok: true, result: { applied: true } });
    expect(io.err).toEqual([]);
  });

  test("pretty mode prints the pretty text with one trailing newline", () => {
    const io = memoryIo();
    emitResult(io, "pretty", { applied: true }, "applied");
    expect(io.out.join("")).toBe("applied\n");
  });

  test("errors: json envelope to stdout, pretty to stderr", () => {
    const e = new MenvError("NOT_FOUND", "no such thing", { name: "X" });
    const j = memoryIo();
    emitError(j, "json", e);
    expect(JSON.parse(j.out.join(""))).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "no such thing", details: { name: "X" } },
    });
    const p = memoryIo();
    emitError(p, "pretty", e);
    expect(p.err.join("")).toBe("menv: no such thing\n");
    expect(p.out).toEqual([]);
  });
});

describe("peekJsonMode", () => {
  test("reads --output from raw argv or env, defaults pretty", () => {
    expect(peekJsonMode(["--output", "json"], {})).toBe("json");
    expect(peekJsonMode(["--output=json"], {})).toBe("json");
    expect(peekJsonMode([], { MENV_OUTPUT: "json" })).toBe("json");
    expect(peekJsonMode(["--output", "pretty"], { MENV_OUTPUT: "json" })).toBe("pretty");
    expect(peekJsonMode([], {})).toBe("pretty");
  });
});
