import { describe, expect, test } from "bun:test";
import { MenvError } from "../../src/core/errors.ts";

describe("MenvError", () => {
  test("maps codes to the spec's exit codes", () => {
    expect(new MenvError("VALIDATION", "x").exitCode).toBe(1);
    expect(new MenvError("PARSE", "x").exitCode).toBe(1);
    expect(new MenvError("NOT_FOUND", "x").exitCode).toBe(1);
    expect(new MenvError("BLOCKED", "x").exitCode).toBe(1);
    expect(new MenvError("AUTH_MISSING", "x").exitCode).toBe(3);
    expect(new MenvError("AUTH_FAILED", "x").exitCode).toBe(3);
    expect(new MenvError("VAULT_IO", "x").exitCode).toBe(4);
  });

  test("AMBIGUOUS maps to exit 1", () => {
    expect(new MenvError("AMBIGUOUS", "x").exitCode).toBe(1);
  });

  test("is an Error and carries code, message, details", () => {
    const e = new MenvError("NOT_FOUND", "no such variable", { name: "FOO" });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("no such variable");
    expect(e.details).toEqual({ name: "FOO" });
  });
});
