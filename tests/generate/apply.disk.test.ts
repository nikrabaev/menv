import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFileOp } from "../../src/generate/apply.ts";
import { disclaimerHeader } from "../../src/generate/ownership.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-apply-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const owned = `${disclaimerHeader({ vault: "local", consumer: "api" })}\nA=1\n`;

describe("applyFileOp", () => {
  test("release strips the disclaimer from an owned file", async () => {
    await Bun.write(join(root, "apps/api/.env"), owned);
    await applyFileOp(root, { action: "release", path: "apps/api/.env" });
    expect(await Bun.file(join(root, "apps/api/.env")).text()).toBe("A=1\n");
  });

  test("delete removes an owned file", async () => {
    await Bun.write(join(root, "f.env"), owned);
    await applyFileOp(root, { action: "delete", path: "f.env" });
    expect(await Bun.file(join(root, "f.env")).exists()).toBe(false);
  });

  test("a user-owned (unmarked) file is never touched", async () => {
    await Bun.write(join(root, "f.env"), "HAND=made\n");
    await applyFileOp(root, { action: "release", path: "f.env" });
    await applyFileOp(root, { action: "delete", path: "f.env" });
    expect(await Bun.file(join(root, "f.env")).text()).toBe("HAND=made\n");
  });

  test("a missing file is a no-op", async () => {
    await applyFileOp(root, { action: "delete", path: "nope.env" });
    expect(await Bun.file(join(root, "nope.env")).exists()).toBe(false);
  });
});
