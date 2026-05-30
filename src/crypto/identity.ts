import { generateKeypair, type Keypair } from "./age.ts";
import { identityToRecipient } from "age-encryption";

export interface KeyBackend {
  get(): Promise<string | null>; // returns stored identity string or null
  set(identity: string): Promise<void>;
}

const SERVICE = "menv-identity";
const ACCOUNT = "menv";

export const keychainBackend: KeyBackend = {
  async get() {
    const p = Bun.spawn(["security", "find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"], {
      stdout: "pipe", stderr: "ignore",
    });
    const out = (await new Response(p.stdout).text()).trim();
    const code = await p.exited;
    return code === 0 && out ? out : null;
  },
  async set(identity) {
    const p = Bun.spawn(
      ["security", "add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", identity, "-U"],
      { stdout: "ignore", stderr: "ignore" },
    );
    await p.exited;
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
