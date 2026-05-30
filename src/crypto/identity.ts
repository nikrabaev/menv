import { generateKeypair, type Keypair } from "./age.ts";
import { identityToRecipient } from "age-encryption";

export interface KeyBackend {
  get(): Promise<string | null>; // returns stored identity string or null
  set(identity: string): Promise<void>;
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
