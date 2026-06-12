import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertManagedBlock } from "../../src/io/gitignore.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-gi-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const read = () => Bun.file(join(root, ".gitignore")).text();

describe("upsertManagedBlock", () => {
  test("creates .gitignore with the block when absent", async () => {
    await upsertManagedBlock(root, [".menv/auth.local.json", ".menv/backups/"]);
    const text = await read();
    expect(text).toContain("# menv (managed block)");
    expect(text).toContain(".menv/auth.local.json");
    expect(text).toContain("# end menv");
  });

  test("preserves user content outside the block and dedupes entries", async () => {
    await Bun.write(join(root, ".gitignore"), "node_modules/\n");
    await upsertManagedBlock(root, ["apps/api/.env"]);
    await upsertManagedBlock(root, ["apps/api/.env", "apps/web/.env"]);
    const text = await read();
    expect(text.startsWith("node_modules/\n")).toBe(true);
    expect(text.match(/apps\/api\/\.env/g)?.length).toBe(1);
    expect(text).toContain("apps/web/.env");
  });

  test("keeps existing block entries when adding new ones", async () => {
    await upsertManagedBlock(root, [".menv/backups/"]);
    await upsertManagedBlock(root, ["apps/api/.env"]);
    const text = await read();
    expect(text).toContain(".menv/backups/");
    expect(text).toContain("apps/api/.env");
  });
});
