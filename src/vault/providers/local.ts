import { join } from "node:path";
import { MenvError } from "../../core/errors.ts";
import { writeFileAtomic } from "../../io/write.ts";
import { decryptWithPassphrase, encryptWithPassphrase } from "../cryptoPool.ts";
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

// The in-memory store is a Map, not a plain object: a key named like an Object
// internal ("__proto__", "constructor") must round-trip as ordinary data, never
// hit the prototype setter (silent data loss) nor return a non-string from get.
function parseMap(text: string, filename: string): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MenvError("VAULT_IO", `menv-local: ${filename} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MenvError("VAULT_IO", `menv-local: ${filename} must contain a JSON object`);
  }
  // JSON.parse defines "__proto__" as an OWN property, so Object.entries reads it.
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") {
      throw new MenvError("VAULT_IO", `menv-local: ${filename} key "${k}" holds a non-string value`);
    }
    map.set(k, v);
  }
  return map;
}

async function loadMap(cfg: LocalVaultConfig, ctx: VaultInitContext): Promise<Map<string, string>> {
  const file = Bun.file(join(ctx.root, cfg.filename));
  if (!(await file.exists())) return new Map(); // a vault that hasn't been written yet is empty
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

// Serialize via a null-prototype object so "__proto__" becomes an own, JSON-
// serializable property (a plain `{}` would route it through the prototype
// setter and drop it). Any write failure is mapped to VAULT_IO (exit-4 contract).
async function persistMap(cfg: LocalVaultConfig, ctx: VaultInitContext, map: Map<string, string>): Promise<void> {
  const obj: Record<string, string> = Object.create(null);
  for (const [k, v] of map) obj[k] = v;
  const json = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    const payload = cfg.encryption ? await encryptWithPassphrase(json, ctx.auth.secret!) : json;
    await writeFileAtomic(ctx.root, cfg.filename, payload);
  } catch (e) {
    if (e instanceof MenvError) throw e;
    throw new MenvError("VAULT_IO", `menv-local: could not write ${cfg.filename}`, e);
  }
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
        return map.get(key);
      },
      // Persist-then-commit: mutate in memory, attempt the write, and on failure
      // roll the in-memory state back so the session never reports a value that
      // did not reach disk.
      async set(key, value) {
        const had = map.has(key);
        const prev = map.get(key);
        map.set(key, value);
        try {
          await persistMap(cfg, ctx, map);
        } catch (e) {
          if (had) map.set(key, prev as string);
          else map.delete(key);
          throw e;
        }
      },
      async remove(key) {
        if (!map.has(key)) return; // removing a missing key is a no-op (no needless write)
        const prev = map.get(key) as string;
        map.delete(key);
        try {
          await persistMap(cfg, ctx, map);
        } catch (e) {
          map.set(key, prev);
          throw e;
        }
      },
      async list() {
        return [...map.keys()].sort();
      },
      async close() {},
    };
  },
};
