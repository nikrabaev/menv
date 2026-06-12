import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRegistry } from "../../src/registry/persist.ts";
import type { Registry } from "../../src/registry/types.ts";

// Two plaintext local vaults, two single-mode consumers, one group. Tests
// mutate copies via overrides or direct assignment on the returned object.
export function makeRegistry(overrides: Partial<Registry> = {}): Registry {
  return {
    schemaVersion: 2,
    defaults: { vault: "local" },
    vaults: {
      local: { vaultType: "menv-local", vaultConfig: { filename: ".menv/vault.json", encryption: false } },
      production: {
        vaultType: "menv-local",
        vaultConfig: { filename: ".menv/vault.production.json", encryption: false },
      },
    },
    consumers: {
      api: { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env" } },
      web: { strategyType: "single", strategyConfig: { baseDir: "apps/web", filename: ".env" } },
    },
    groups: { db: { title: "Database" } },
    globals: {},
    variables: {},
    compose: { files: [] },
    ...overrides,
  };
}

export async function tmpRepo(registry?: Registry): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "menv-cli-"));
  if (registry) await saveRegistry(root, registry);
  return root;
}
