import { describe, expect, test } from "bun:test";
import type { MenvError } from "../../../src/core/errors.ts";
import { planComposeBind, planComposeUnbind } from "../../../src/core/ops/compose.ts";
import { makeRegistry } from "../../helpers/fixtures.ts";

describe("compose ops", () => {
  test("bind appends; duplicate bind → VALIDATION", () => {
    const { next } = planComposeBind(makeRegistry(), { file: "docker-compose.yml" });
    expect(next.compose.files).toEqual(["docker-compose.yml"]);
    try {
      planComposeBind(next, { file: "docker-compose.yml" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });

  test("unbind removes; unbinding an unbound file → NOT_FOUND", () => {
    const bound = planComposeBind(makeRegistry(), { file: "docker-compose.yml" }).next;
    const { next } = planComposeUnbind(bound, { file: "docker-compose.yml" });
    expect(next.compose.files).toEqual([]);
    try {
      planComposeUnbind(makeRegistry(), { file: "nope.yml" });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });
});
