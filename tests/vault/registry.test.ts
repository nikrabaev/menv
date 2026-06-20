import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../src/core/errors.ts";
import { getProvider, knownProviderTypes } from "../../src/vault/registry.ts";

describe("provider registry", () => {
  test("resolves menv-local", () => {
    expect(getProvider("menv-local").type).toBe("menv-local");
  });

  test("lists known types", () => {
    expect(knownProviderTypes()).toEqual(["menv-local"]);
  });

  test("unknown type → VALIDATION naming the known types", () => {
    try {
      getProvider("hashicorp");
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect((e as MenvError).message).toContain("menv-local");
    }
  });
});
