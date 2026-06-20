import { describe, expect, test } from "bun:test";
import { findDependents } from "../../src/core/refs.ts";

describe("findDependents", () => {
  test("finds every value referencing the target", () => {
    const records = [
      { variable: "PUBLIC_URL", vault: "local", consumer: "web", raw: "https://${API_HOST}/api" },
      { variable: "HEALTH", vault: "local", consumer: "web", raw: "${PUBLIC_URL}/health" },
      { variable: "OTHER", vault: "production", consumer: "api", raw: "plain" },
      { variable: "MIRROR", vault: "production", consumer: "api", raw: "${API_HOST}" },
    ];
    expect(findDependents("API_HOST", records)).toEqual([
      { variable: "PUBLIC_URL", vault: "local", consumer: "web" },
      { variable: "MIRROR", vault: "production", consumer: "api" },
    ]);
  });

  test("escaped refs do not count; no dependents → empty list", () => {
    const records = [{ variable: "A", vault: "local", consumer: "web", raw: "$${API_HOST}" }];
    expect(findDependents("API_HOST", records)).toEqual([]);
  });
});
