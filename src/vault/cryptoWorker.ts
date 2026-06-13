// Off-main-thread age crypto. scrypt (age's passphrase KDF, work factor 2^18)
// is a ~1s SYNCHRONOUS CPU burst; on the main thread it freezes the TUI's input
// and render loop for the whole derivation. Running it here keeps that loop
// responsive while a vault unlocks. The crypto itself is unchanged — this only
// relocates where age.ts runs. Passphrases and plaintext pass through this
// worker transiently, in-process only.
import { decryptWithPassphrase, encryptWithPassphrase } from "./age.ts";

type Request =
  | { id: number; op: "decrypt"; passphrase: string; data: Uint8Array }
  | { id: number; op: "encrypt"; passphrase: string; text: string };

// `self` is typed as a DOM Window under our libs; cast to the worker shape we
// actually use so the postMessage/onmessage signatures line up.
const ctx = self as unknown as {
  onmessage: ((e: { data: Request }) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = async ({ data: msg }) => {
  try {
    if (msg.op === "decrypt") {
      const text = await decryptWithPassphrase(msg.data, msg.passphrase);
      ctx.postMessage({ id: msg.id, ok: true, text });
    } else {
      const bytes = await encryptWithPassphrase(msg.text, msg.passphrase);
      ctx.postMessage({ id: msg.id, ok: true, bytes });
    }
  } catch (err) {
    ctx.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
