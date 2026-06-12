import { join } from "node:path";
import { MenvError } from "../core/errors.ts";
import { upsertManagedBlock } from "../io/gitignore.ts";
import { REGISTRY_FILENAME, saveRegistry } from "../registry/persist.ts";
import type { Registry } from "../registry/types.ts";

export interface InitOptions {
  encrypt: boolean; // default true (commander's --encrypt/--no-encrypt pair)
}

// Creates an EMPTY registry — no scanning, no discovery (spec requirement 6).
// `menv import` is the explicit ingestion path. The vault file itself is
// created lazily on the first `set`.
export async function runInit(root: string, opts: InitOptions): Promise<{ created: string[] }> {
  if (await Bun.file(join(root, REGISTRY_FILENAME)).exists()) {
    throw new MenvError("VALIDATION", `already initialized — ${REGISTRY_FILENAME} exists`);
  }
  if (await Bun.file(join(root, "menv.toml")).exists()) {
    throw new MenvError(
      "VALIDATION",
      "v1 repo detected (menv.toml) — v2 has no migration; remove the v1 files first",
    );
  }
  const registry: Registry = {
    schemaVersion: 2,
    defaults: { vault: "local" },
    vaults: {
      local: { vaultType: "menv-local", vaultConfig: { filename: ".menv/vault.json", encryption: opts.encrypt } },
    },
    consumers: {},
    groups: {},
    globals: {},
    variables: {},
    compose: { files: [] },
  };
  await saveRegistry(root, registry);
  const ignores = [".menv/auth.local.json", ".menv/backups/"];
  if (!opts.encrypt) ignores.push(".menv/vault.json"); // plaintext vault must never be committed
  await upsertManagedBlock(root, ignores);
  return { created: [REGISTRY_FILENAME, ".gitignore (menv block)"] };
}
