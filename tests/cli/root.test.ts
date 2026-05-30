import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot } from "../../src/cli/root.ts";

test("walks up to a dir containing menv.toml", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "menv.toml"), "");
  const deep = join(root, "a", "b");
  await mkdir(deep, { recursive: true });
  expect(await findRepoRoot(deep)).toBe(root);
});

test("falls back to a .git dir", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, ".git"), { recursive: true });
  const deep = join(root, "x");
  await mkdir(deep, { recursive: true });
  expect(await findRepoRoot(deep)).toBe(root);
});
