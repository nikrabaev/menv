import { expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupKey, collectEnvFiles } from "../../src/io/backup.ts";

test("backupKey formats local time as zero-padded YYYYMMDDHHmmss", () => {
  // Local-time constructor (month is 0-based): 2026-01-02 03:04:05.
  expect(backupKey(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102030405");
});

// A workspace repo: root package.json declares apps/* and apps/api is a package,
// mirroring what `menv init` discovery (scanRepo) would ingest from.
async function workspaceRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "repo", workspaces: ["apps/*"] }));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  await Bun.write(join(root, "apps", "api", "package.json"), JSON.stringify({ name: "api" }));
  return root;
}

// Scope = the dirs init ingests env files from (repo root + workspace packages),
// times every `.env`/`.env.*` variant menv materializes (`.env.<env>` in perenv
// mode, `.local` overrides, `.env.example`, `.env.compose`). Files elsewhere —
// nested checkouts (git worktrees), non-workspace dirs, node_modules — are not
// menv's to snapshot.
test("collectEnvFiles finds every .env/.env.* variant in root + workspace dirs", async () => {
  const root = await workspaceRepo();
  await Bun.write(join(root, ".env"), "A=1\n");
  await Bun.write(join(root, ".env.example"), "A=\n");
  await Bun.write(join(root, ".env.local"), "A=2\n");
  await Bun.write(join(root, "apps", "api", ".env"), "B=2\n");
  await Bun.write(join(root, "apps", "api", ".env.example"), "B=\n");
  // Per-env files (perenv mode), local overrides, and compose env files:
  await Bun.write(join(root, "apps", "api", ".env.dev"), "X=1\n");
  await Bun.write(join(root, "apps", "api", ".env.production"), "X=1\n");
  await Bun.write(join(root, "apps", "api", ".env.dev.local"), "X=1\n");
  await Bun.write(join(root, "apps", "api", ".env.compose"), "X=1\n");
  // Not dotenv files:
  await Bun.write(join(root, ".envrc"), "use nix\n");
  await Bun.write(join(root, "apps", "api", "env.txt"), "X=1\n");

  expect(await collectEnvFiles(root)).toEqual([
    ".env",
    ".env.example",
    ".env.local",
    "apps/api/.env",
    "apps/api/.env.compose",
    "apps/api/.env.dev",
    "apps/api/.env.dev.local",
    "apps/api/.env.example",
    "apps/api/.env.production",
  ]);
});

// Regression: a repo-wide recursive walk swept in env files from git worktree
// checkouts nested inside the repo (each one a full copy of the tree, env files
// included). Only init's scan targets count — a worktree's dirs never match the
// top-level workspace globs.
test("collectEnvFiles ignores dirs outside the init scan targets (worktrees, junk)", async () => {
  const root = await workspaceRepo();
  await Bun.write(join(root, ".env"), "A=1\n");
  // A worktree checkout of the same repo, env files and all:
  await mkdir(join(root, "worktrees", "feature", "apps", "api"), { recursive: true });
  await Bun.write(join(root, "worktrees", "feature", "package.json"), JSON.stringify({ name: "repo", workspaces: ["apps/*"] }));
  await Bun.write(join(root, "worktrees", "feature", ".env"), "W=1\n");
  await Bun.write(join(root, "worktrees", "feature", "apps", "api", ".env"), "W=2\n");
  // A nested dir that is not a workspace package:
  await mkdir(join(root, "tools"), { recursive: true });
  await Bun.write(join(root, "tools", ".env"), "T=1\n");
  // Classic junk dirs:
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await Bun.write(join(root, "node_modules", "pkg", ".env"), "N=1\n");
  await mkdir(join(root, ".menv", "backups", "old"), { recursive: true });
  await Bun.write(join(root, ".menv", "backups", "old", ".env"), "O=1\n");

  expect(await collectEnvFiles(root)).toEqual([".env"]);
});

test("collectEnvFiles returns [] for a repo with no env files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  expect(await collectEnvFiles(root)).toEqual([]);
});

// Regression (the "menv backup freezes" bug): collection must never walk the
// whole tree — an unreadable dir outside the scan targets is the observable
// probe. A repo-wide walk dies on it with EACCES (or spends minutes inside
// node_modules); a target-scoped scan never touches it.
test("collectEnvFiles never reads dirs outside the scan targets", async () => {
  const root = await workspaceRepo();
  await Bun.write(join(root, ".env"), "A=1\n");
  const lockedJunk = join(root, "node_modules", "pkg");
  const lockedPrivate = join(root, "private");
  await mkdir(lockedJunk, { recursive: true });
  await mkdir(lockedPrivate, { recursive: true });
  await chmod(lockedJunk, 0o000);
  await chmod(lockedPrivate, 0o000);
  try {
    expect(await collectEnvFiles(root)).toEqual([".env"]);
  } finally {
    await chmod(lockedJunk, 0o755);
    await chmod(lockedPrivate, 0o755);
  }
});

// Pins symlink semantics carried over from the previous scans: symlinked env
// files are not collected (and symlinked dirs are not scan targets).
test("collectEnvFiles ignores symlinked env files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "shared"), { recursive: true });
  await Bun.write(join(root, "shared", "env.txt"), "A=1\n");
  await Bun.write(join(root, ".env.example"), "A=\n");
  symlinkSync(join(root, "shared", "env.txt"), join(root, ".env"));
  expect(await collectEnvFiles(root)).toEqual([".env.example"]);
});
