import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInit } from "../../src/cli/init.ts";
import { generateKeypair } from "../../src/crypto/age.ts";
import type { KeyBackend } from "../../src/crypto/identity.ts";

const envBody = (env: Record<string, string>) =>
  Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";

export interface ScaffoldOpts {
  // app name -> its `.env` contents (undefined = the app exists but has no .env)
  apps?: Record<string, Record<string, string> | undefined>;
  // repo-root `.env` contents
  rootEnv?: Record<string, string>;
  // extra raw files (relative path -> contents) written before `init` runs
  extraFiles?: Record<string, string>;
}

// A temp monorepo initialized with an in-memory (keychain-style) backend. Returns
// the repo root and the backend to thread into command handlers.
export async function scaffold(opts: ScaffoldOpts = {}): Promise<{ root: string; backend: KeyBackend }> {
  const apps = opts.apps ?? { api: { PORT: "3000" } };
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await Bun.write(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n");
  for (const [name, env] of Object.entries(apps)) {
    await mkdir(join(root, "apps", name), { recursive: true });
    await Bun.write(join(root, "apps", name, "package.json"), JSON.stringify({ name }));
    if (env) await Bun.write(join(root, "apps", name, ".env"), envBody(env));
  }
  if (opts.rootEnv) await Bun.write(join(root, ".env"), envBody(opts.rootEnv));
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await Bun.write(join(root, rel), content);
  }

  const kp = await generateKeypair();
  const backend: KeyBackend = {
    async get() {
      return kp.identity;
    },
    async set() {
      return { kind: "keychain" as const };
    },
  };
  await runInit(root, { backend, stamp: "init" });
  return { root, backend };
}
