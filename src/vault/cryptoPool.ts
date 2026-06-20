// Cache + off-thread execution for the menv-local provider's age crypto. The
// provider calls THESE instead of age.ts directly, which buys two things:
//
//   1. The ~1s scrypt KDF runs in a Worker, off the UI thread — so unlocking a
//      vault at startup no longer freezes scrolling/rendering.
//   2. Repeat decryptions of the same ciphertext (the TUI snapshot, then the
//      background `check`, then any reload) collapse to a hash lookup instead of
//      re-running scrypt. Startup used to decrypt every vault twice.
//
// If the Worker can't be created or fails to load (e.g. not bundled into a
// compiled binary), every call transparently falls back to running the crypto
// on the current thread — correct, just blocking, i.e. the old behavior.
import { decryptWithPassphrase as decryptOnThread, encryptWithPassphrase as encryptOnThread } from "./age.ts";

// SHA-256(passphrase ‖ ciphertext) → plaintext. The ciphertext embeds age's
// scrypt salt, so identical bytes + passphrase always derive identical
// plaintext; a changed file produces different bytes and misses the cache.
// Plaintext is held only for the process lifetime — the TUI already keeps the
// same decrypted values in memory, so this adds no new at-rest exposure.
const plaintextCache = new Map<string, string>();
const cacheKey = (ciphertext: Uint8Array, passphrase: string): string =>
  new Bun.CryptoHasher("sha256").update(passphrase).update(ciphertext).digest("hex");

// Distinguishes "the worker mechanism is unavailable" (→ fall back to on-thread)
// from a genuine crypto failure like a wrong passphrase (→ propagate).
class WorkerUnavailable extends Error {}

type RefCountable = Worker & { ref?: () => void; unref?: () => void };
type Pending = { resolve: (value: never) => void; reject: (err: Error) => void };

let worker: RefCountable | null = null;
let workerDead = false;
let seq = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): RefCountable | null {
  if (workerDead) return null;
  if (worker !== null) return worker;
  try {
    const w = new Worker(new URL("./cryptoWorker.ts", import.meta.url)) as RefCountable;
    w.addEventListener("message", (e: MessageEvent) => {
      const { id, ok, text, bytes, error } = e.data as {
        id: number;
        ok: boolean;
        text?: string;
        bytes?: Uint8Array;
        error?: string;
      };
      const p = pending.get(id);
      if (p === undefined) return;
      pending.delete(id);
      if (pending.size === 0) w.unref?.(); // idle worker shouldn't keep the process alive
      if (ok) (p.resolve as (v: unknown) => void)(text !== undefined ? text : bytes);
      else p.reject(new Error(error ?? "crypto error"));
    });
    w.addEventListener("error", () => {
      // The worker script failed to load/run. Fail in-flight calls with
      // WorkerUnavailable so they fall back to on-thread crypto, and stop trying.
      workerDead = true;
      worker = null;
      for (const p of pending.values()) p.reject(new WorkerUnavailable());
      pending.clear();
    });
    worker = w;
    return w;
  } catch {
    workerDead = true;
    return null;
  }
}

function offload<T>(op: "decrypt" | "encrypt", payload: Record<string, unknown>): Promise<T> {
  const w = ensureWorker();
  if (w === null) return Promise.reject(new WorkerUnavailable());
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    if (pending.size === 0) w.ref?.(); // keep the process alive while crypto is in flight
    pending.set(id, { resolve: resolve as (value: never) => void, reject });
    w.postMessage({ id, op, ...payload });
  });
}

export async function decryptWithPassphrase(ciphertext: Uint8Array, passphrase: string): Promise<string> {
  const key = cacheKey(ciphertext, passphrase);
  const cached = plaintextCache.get(key);
  if (cached !== undefined) return cached;
  let text: string;
  try {
    text = await offload<string>("decrypt", { passphrase, data: ciphertext });
  } catch (e) {
    if (!(e instanceof WorkerUnavailable)) throw e; // wrong key etc. — propagate
    text = await decryptOnThread(ciphertext, passphrase);
  }
  plaintextCache.set(key, text);
  return text;
}

export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await offload<Uint8Array>("encrypt", { passphrase, text: plaintext });
  } catch (e) {
    if (!(e instanceof WorkerUnavailable)) throw e;
    bytes = await encryptOnThread(plaintext, passphrase);
  }
  // A read of what we just wrote shouldn't re-run scrypt.
  plaintextCache.set(cacheKey(bytes, passphrase), plaintext);
  return bytes;
}
