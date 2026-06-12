import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../src/io/write.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-write-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  test("writes string content, creating parent dirs", async () => {
    const rel = await writeFileAtomic(root, "apps/api/.env", "A=1\n");
    expect(rel).toBe("apps/api/.env");
    expect(await Bun.file(join(root, "apps/api/.env")).text()).toBe("A=1\n");
  });

  test("writes binary content", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await writeFileAtomic(root, "blob.bin", bytes);
    expect(new Uint8Array(await Bun.file(join(root, "blob.bin")).arrayBuffer())).toEqual(bytes);
  });

  test("overwrites without leaving tmp files or backups", async () => {
    await writeFileAtomic(root, "f.txt", "one");
    await writeFileAtomic(root, "f.txt", "two");
    expect(await Bun.file(join(root, "f.txt")).text()).toBe("two");
    expect(await readdir(root)).toEqual(["f.txt"]); // no .menv-tmp, no .menv/backups
  });
});
