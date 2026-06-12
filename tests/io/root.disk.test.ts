import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRoot } from "../../src/io/root.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "menv-root-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("findRoot", () => {
  test("finds menv.json in the start dir", async () => {
    await Bun.write(join(dir, "menv.json"), "{}");
    expect(await findRoot(dir)).toBe(dir);
  });

  test("walks up to an ancestor", async () => {
    await Bun.write(join(dir, "menv.json"), "{}");
    const nested = join(dir, "apps/api/src");
    await mkdir(nested, { recursive: true });
    expect(await findRoot(nested)).toBe(dir);
  });

  test("returns null when no menv.json exists anywhere up the tree", async () => {
    expect(await findRoot(dir)).toBeNull();
  });
});
