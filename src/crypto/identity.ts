import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { identityToRecipient } from "age-encryption";
import type { KeyBackendConfig } from "../core/types.ts";
import { decryptWithPassphrase, encryptWithPassphrase, generateKeypair, type Keypair } from "./age.ts";

// A place the secret age identity can be stored. `get` returns the identity
// string (or null if none is stored yet); `set` persists a newly generated
// identity and returns the config that must be recorded in menv.toml so later
// runs can reconstruct the same backend (notably the 1Password reference).
export interface KeyBackend {
  get(): Promise<string | null>;
  set(identity: string): Promise<KeyBackendConfig>;
}

// Supplies a passphrase to the password backend. The interactive implementation
// prompts; the env implementation reads MENV_PASSPHRASE. `unlock` is for an
// existing blob, `create` for a brand-new one (prompt twice + confirm).
export interface PassphraseProvider {
  unlock(): Promise<string>;
  create(): Promise<string>;
  // When true the password backend may call `unlock` again after a wrong
  // passphrase (a re-prompt). Non-interactive providers get a single attempt.
  interactive?: boolean;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

const SERVICE = "menv-identity";
const ACCOUNT = "menv";

// macOS `security find-generic-password` exits 44 when the requested item is
// absent from the keychain. Any other non-zero exit is a real failure (locked
// keychain, denied prompt, `security` unavailable) and must NOT be mistaken for
// "no identity" — doing so would silently regenerate a new identity and orphan
// the existing .menv/values/*.age vault encrypted to the old recipient.
const ITEM_NOT_FOUND_EXIT = 44;

/**
 * Classify the exit code of `security find-generic-password`.
 * - `found`: item retrieved (exit 0)
 * - `not-found`: item genuinely absent (exit 44) — caller returns null
 * - `error`: any other non-zero exit — caller must throw, never treat as absent
 */
export function classifyFindExitCode(code: number): "found" | "not-found" | "error" {
  if (code === 0) return "found";
  if (code === ITEM_NOT_FOUND_EXIT) return "not-found";
  return "error";
}

export const keychainBackend: KeyBackend = {
  async get() {
    const p = Bun.spawn(["security", "find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"], {
      stdout: "pipe", stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ]);
    const code = await p.exited;
    switch (classifyFindExitCode(code)) {
      case "found":
        return out.trim() || null;
      case "not-found":
        return null;
      case "error":
        throw new Error(
          `security find-generic-password failed (exit ${code}): ${err.trim()}`,
        );
    }
  },
  async set(identity) {
    // The identity is passed via the `-w <identity>` CLI argument, which is a
    // small, same-user process-args exposure window; the login keychain is the
    // protection boundary by design. We must surface write failures so a failed
    // persist is never silent — otherwise the next run regenerates a fresh
    // identity and the existing vault becomes permanently undecryptable.
    const p = Bun.spawn(
      ["security", "add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", identity, "-U"],
      { stdout: "ignore", stderr: "pipe" },
    );
    const err = (await new Response(p.stderr).text()).trim();
    const code = await p.exited;
    if (code !== 0) {
      throw new Error(`security add-generic-password failed (exit ${code}): ${err}`);
    }
    return { kind: "keychain" };
  },
};

export async function loadOrCreateIdentity(backend: KeyBackend = keychainBackend): Promise<Keypair> {
  const existing = await backend.get();
  if (existing) {
    return { identity: existing, recipient: await identityToRecipient(existing) };
  }
  const kp = await generateKeypair();
  await backend.set(kp.identity);
  return kp;
}

// ── password backend ──────────────────────────────────────────────────────────
// Stores the identity as a passphrase-encrypted blob at .menv/identity.age. The
// blob is committed (see GITIGNORE_BLOCK), so the vault travels with the repo;
// the passphrase is the only secret.

export const IDENTITY_FILE = "identity.age";

export interface PasswordBackendOpts {
  root: string;
  pass: PassphraseProvider;
  // Injectable for tests; default to on-disk .menv/identity.age.
  readFile?: (path: string) => Promise<Uint8Array | null>;
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  retries?: number; // interactive re-prompts on a wrong passphrase (default 3)
}

async function defaultReadFile(path: string): Promise<Uint8Array | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  return new Uint8Array(await f.arrayBuffer());
}

async function defaultWriteFile(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, data);
}

export function passwordBackend(opts: PasswordBackendOpts): KeyBackend {
  const path = join(opts.root, ".menv", IDENTITY_FILE);
  const readFile = opts.readFile ?? defaultReadFile;
  const writeFile = opts.writeFile ?? defaultWriteFile;
  return {
    async get() {
      const blob = await readFile(path);
      if (!blob) return null;
      const attempts = opts.pass.interactive ? (opts.retries ?? 3) : 1;
      for (let i = 0; i < attempts; i++) {
        const passphrase = await opts.pass.unlock();
        try {
          return await decryptWithPassphrase(blob, passphrase);
        } catch {
          // wrong passphrase — re-prompt if interactive, else fall through
        }
      }
      throw new WrongPassphraseError();
    },
    async set(identity) {
      const passphrase = await opts.pass.create();
      const ct = await encryptWithPassphrase(identity, passphrase);
      await writeFile(path, ct);
      return { kind: "password" };
    },
  };
}

// Reads MENV_PASSPHRASE for the headless `generate` path; throws (rather than
// blocking on stdin) when it is unset.
export function envPassphraseProvider(env: Record<string, string | undefined> = Bun.env): PassphraseProvider {
  const read = () => {
    const v = env.MENV_PASSPHRASE;
    if (!v) {
      throw new Error(
        "MENV_PASSPHRASE is not set — required for the password backend in a non-interactive context",
      );
    }
    return v;
  };
  return {
    interactive: false,
    async unlock() { return read(); },
    async create() { return read(); },
  };
}

// ── 1Password backend ─────────────────────────────────────────────────────────
// Stores the identity in a 1Password item via the `op` CLI; only the
// `op://vault/item/field` reference is recorded in menv.toml.

export interface OpResult { code: number; stdout: string; stderr: string; }
export type OpExec = (args: string[]) => Promise<OpResult>;

export interface OnePasswordBackendOpts {
  ref?: string;          // existing op:// reference (from menv.toml) — needed by get()
  vault?: string;        // vault for a newly created item (default "Private")
  title?: string;        // title for a newly created item
  exec?: OpExec;         // injectable for tests; default spawns `op`
}

// Conventional "command not found" exit; defaultOpExec uses it when `op` is absent.
const OP_NOT_FOUND = 127;

const defaultOpExec: OpExec = async (args) => {
  try {
    const p = Bun.spawn(["op", ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ]);
    return { code: await p.exited, stdout, stderr };
  } catch {
    // Bun.spawn throws (ENOENT) when `op` isn't on PATH.
    return { code: OP_NOT_FOUND, stdout: "", stderr: "op: command not found" };
  }
};

function opError(r: OpResult): Error {
  if (r.code === OP_NOT_FOUND || /command not found|no such file/i.test(r.stderr)) {
    return new Error(
      "1Password CLI (`op`) not found. Install it: https://developer.1password.com/docs/cli/get-started/",
    );
  }
  if (/sign[ -]?in|not currently signed in|authoriz|session/i.test(r.stderr)) {
    return new Error(`1Password is not signed in. Run \`op signin\` and try again. (${r.stderr.trim()})`);
  }
  return new Error(`op failed (exit ${r.code}): ${r.stderr.trim()}`);
}

export function onePasswordBackend(opts: OnePasswordBackendOpts): KeyBackend {
  const exec = opts.exec ?? defaultOpExec;
  return {
    async get() {
      if (!opts.ref) return null;
      const r = await exec(["read", opts.ref]);
      if (r.code !== 0) throw opError(r);
      return r.stdout.trim() || null;
    },
    async set(identity) {
      const vault = opts.vault ?? "Private";
      const title = opts.title ?? "menv identity";
      const r = await exec([
        "item", "create",
        "--category", "password",
        "--title", title,
        "--vault", vault,
        "--format", "json",
        `password=${identity}`,
      ]);
      if (r.code !== 0) throw opError(r);
      let id: string | undefined;
      try {
        id = (JSON.parse(r.stdout) as { id?: string }).id;
      } catch {
        throw new Error("1Password: could not parse `op item create` output");
      }
      if (!id) throw new Error("1Password: created item has no id");
      return { kind: "1password", opRef: `op://${vault}/${id}/password` };
    },
  };
}
