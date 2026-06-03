import { expect, test } from "bun:test";
import { decryptWithPassphrase, encryptWithPassphrase } from "../../src/crypto/age.ts";

test("encrypts and decrypts a value with a passphrase", async () => {
  const ct = await encryptWithPassphrase("AGE-SECRET-KEY-1EXAMPLE", "correct horse battery staple");
  const pt = await decryptWithPassphrase(ct, "correct horse battery staple");
  expect(pt).toBe("AGE-SECRET-KEY-1EXAMPLE");
});

test("decrypting with the wrong passphrase throws", async () => {
  const ct = await encryptWithPassphrase("secret", "right");
  expect(decryptWithPassphrase(ct, "wrong")).rejects.toThrow();
});
