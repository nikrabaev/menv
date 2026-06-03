import { expect, test } from "bun:test";
import { encryptWithPassphrase, generateKeypair } from "../../src/crypto/age.ts";
import { type PassphraseProvider, passwordBackend, WrongPassphraseError } from "../../src/crypto/identity.ts";

function stubPass(pw: string, interactive = false): PassphraseProvider {
  return { interactive, async unlock() { return pw; }, async create() { return pw; } };
}

// An in-memory blob store standing in for .menv/identity.age.
function memFile() {
  let stored: Uint8Array | null = null;
  return {
    readFile: async () => stored,
    writeFile: async (_p: string, d: Uint8Array) => { stored = d; },
    get stored() { return stored; },
    set stored(v: Uint8Array | null) { stored = v; },
  };
}

test("set writes a passphrase-encrypted blob and returns the password config", async () => {
  const file = memFile();
  const kp = await generateKeypair();
  const backend = passwordBackend({ root: "/x", pass: stubPass("hunter2"), readFile: file.readFile, writeFile: file.writeFile });

  const cfg = await backend.set(kp.identity);
  expect(cfg).toEqual({ kind: "password" });
  expect(file.stored).not.toBeNull();
  // The blob is ciphertext, not the raw identity.
  expect(new TextDecoder().decode(file.stored!)).not.toContain(kp.identity);
});

test("get round-trips the identity through the blob", async () => {
  const file = memFile();
  const kp = await generateKeypair();
  const backend = passwordBackend({ root: "/x", pass: stubPass("hunter2"), readFile: file.readFile, writeFile: file.writeFile });
  await backend.set(kp.identity);
  expect(await backend.get()).toBe(kp.identity);
});

test("get returns null when no blob exists", async () => {
  const backend = passwordBackend({ root: "/x", pass: stubPass("x"), readFile: async () => null, writeFile: async () => {} });
  expect(await backend.get()).toBeNull();
});

test("get throws WrongPassphraseError on a bad passphrase (single attempt)", async () => {
  const kp = await generateKeypair();
  const blob = await encryptWithPassphrase(kp.identity, "real");
  const backend = passwordBackend({ root: "/x", pass: stubPass("nope"), readFile: async () => blob, writeFile: async () => {} });
  expect(backend.get()).rejects.toThrow(WrongPassphraseError);
});

test("an interactive provider is re-prompted after a wrong passphrase", async () => {
  const kp = await generateKeypair();
  const blob = await encryptWithPassphrase(kp.identity, "real");
  let calls = 0;
  const pass: PassphraseProvider = {
    interactive: true,
    async unlock() { calls++; return calls === 1 ? "wrong" : "real"; },
    async create() { return "real"; },
  };
  const backend = passwordBackend({ root: "/x", pass, readFile: async () => blob, writeFile: async () => {}, retries: 3 });
  expect(await backend.get()).toBe(kp.identity);
  expect(calls).toBe(2);
});
