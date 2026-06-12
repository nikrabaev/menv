import { join } from "node:path";
import { MenvError } from "../../core/errors.ts";
import { writeFileAtomic } from "../../io/write.ts";
import { decryptWithPassphrase, encryptWithPassphrase } from "../age.ts";
import type { VaultInitContext, VaultProvider, VaultSession } from "../provider.ts";

interface LocalVaultConfig {
  filename: string;
  encryption: boolean;
}

function parseConfig(config: unknown): LocalVaultConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new MenvError("VALIDATION", "menv-local: vaultConfig must be an object");
  }
  const c = config as Record<string, unknown>;
  if (typeof c.filename !== "string" || c.filename === "") {
    throw new MenvError("VALIDATION", "menv-local: vaultConfig.filename must be a non-empty string");
  }
  if (typeof c.encryption !== "boolean") {
    throw new MenvError("VALIDATION", "menv-local: vaultConfig.encryption must be a boolean");
  }
  return { filename: c.filename, encryption: c.encryption };
}

function parseMap(text: string, filename: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MenvError("VAULT_IO", `menv-local: ${filename} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MenvError("VAULT_IO", `menv-local: ${filename} must contain a JSON object`);
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") {
      throw new MenvError("VAULT_IO", `menv-local: ${filename} key "${k}" holds a non-string value`);
    }
  }
  return parsed as Record<string, string>;
}

async function loadMap(cfg: LocalVaultConfig, ctx: VaultInitContext): Promise<Record<string, string>> {
  const file = Bun.file(join(ctx.root, cfg.filename));
  if (!(await file.exists())) return {}; // a vault that hasn't been written yet is empty
  if (!cfg.encryption) return parseMap(await file.text(), cfg.filename);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = await decryptWithPassphrase(bytes, ctx.auth.secret!);
  } catch {
    throw new MenvError("AUTH_FAILED", `menv-local: could not decrypt ${cfg.filename} (wrong key?)`);
  }
  return parseMap(text, cfg.filename);
}

async function persistMap(
  cfg: LocalVaultConfig,
  ctx: VaultInitContext,
  map: Record<string, string>,
): Promise<void> {
  const json = `${JSON.stringify(map, null, 2)}\n`;
  if (!cfg.encryption) {
    await writeFileAtomic(ctx.root, cfg.filename, json);
    return;
  }
  await writeFileAtomic(ctx.root, cfg.filename, await encryptWithPassphrase(json, ctx.auth.secret!));
}

export const localProvider: VaultProvider = {
  type: "menv-local",

  async init(config: unknown, ctx: VaultInitContext): Promise<VaultSession> {
    const cfg = parseConfig(config);
    if (cfg.encryption && ctx.auth.secret === undefined) {
      throw new MenvError("AUTH_MISSING", `menv-local: ${cfg.filename} is encrypted and no key was provided`);
    }
    const map = await loadMap(cfg, ctx);
    return {
      async get(key) {
        return map[key];
      },
      async set(key, value) {
        map[key] = value;
        await persistMap(cfg, ctx, map); // persist per mutation: a crash never loses acknowledged writes
      },
      async remove(key) {
        delete map[key];
        await persistMap(cfg, ctx, map);
      },
      async list() {
        return Object.keys(map).sort();
      },
      async close() {},
    };
  },
};
