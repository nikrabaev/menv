import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBackend } from "../../src/crypto/resolveBackend.ts";
import { keychainBackend } from "../../src/crypto/identity.ts";
import { generateKeypair } from "../../src/crypto/age.ts";

test("keychain resolves to the keychain backend (on macOS)", () => {
  // The suite runs on darwin; the non-darwin guard is exercised separately below.
  if (process.platform !== "darwin") return;
  const backend = resolveBackend({ kind: "keychain" }, { root: "/x", interactive: false });
  expect(backend).toBe(keychainBackend);
});

test("keychain on a non-macOS platform throws an actionable error", () => {
  const orig = process.platform;
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  try {
    expect(() => resolveBackend({ kind: "keychain" }, { root: "/x", interactive: false })).toThrow(/Keychain/);
  } finally {
    Object.defineProperty(process, "platform", { value: orig, configurable: true });
  }
});

test("1password resolves to a backend that reads via op (null without a ref)", async () => {
  const backend = resolveBackend({ kind: "1password" }, {
    root: "/x",
    interactive: false,
    // No ref ⇒ get() short-circuits to null without invoking op.
  });
  expect(await backend.get()).toBeNull();
});

test("non-interactive password resolves to a backend driven by MENV_PASSPHRASE", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-rb-"));
  const prev = Bun.env.MENV_PASSPHRASE;
  Bun.env.MENV_PASSPHRASE = "from-env";
  try {
    const backend = resolveBackend({ kind: "password" }, { root, interactive: false });
    const kp = await generateKeypair();
    await backend.set(kp.identity); // encrypts under the env passphrase
    expect(await Bun.file(join(root, ".menv", "identity.age")).exists()).toBe(true);
    expect(await backend.get()).toBe(kp.identity);
  } finally {
    if (prev === undefined) delete Bun.env.MENV_PASSPHRASE;
    else Bun.env.MENV_PASSPHRASE = prev;
  }
});

test("password backend throws when MENV_PASSPHRASE is unset and non-interactive", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-rb-"));
  const prev = Bun.env.MENV_PASSPHRASE;
  delete Bun.env.MENV_PASSPHRASE;
  try {
    const backend = resolveBackend({ kind: "password" }, { root, interactive: false });
    expect(backend.set("AGE-SECRET-KEY-1X")).rejects.toThrow(/MENV_PASSPHRASE/);
  } finally {
    if (prev !== undefined) Bun.env.MENV_PASSPHRASE = prev;
  }
});
