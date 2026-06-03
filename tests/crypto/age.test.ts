import { expect, test } from "bun:test";
import { decryptWithIdentity, encryptToRecipients, generateKeypair } from "../../src/crypto/age.ts";

test("encrypts to recipient and decrypts with identity", async () => {
  const { identity, recipient } = await generateKeypair();
  const ct = await encryptToRecipients("secret-data", [recipient]);
  const pt = await decryptWithIdentity(ct, identity);
  expect(pt).toBe("secret-data");
});

test("supports multiple recipients", async () => {
  const a = await generateKeypair();
  const b = await generateKeypair();
  const ct = await encryptToRecipients("multi", [a.recipient, b.recipient]);
  expect(await decryptWithIdentity(ct, a.identity)).toBe("multi");
  expect(await decryptWithIdentity(ct, b.identity)).toBe("multi");
});
