import { describe, expect, test } from "bun:test";
import { decryptWithPassphrase, encryptWithPassphrase } from "../../src/vault/age.ts";

describe("age passphrase encryption", () => {
  test("round-trips text", async () => {
    const ct = await encryptWithPassphrase('{"k":"v"}', "correct horse");
    expect(await decryptWithPassphrase(ct, "correct horse")).toBe('{"k":"v"}');
  });

  test("produces age-format ciphertext, not plaintext", async () => {
    const ct = await encryptWithPassphrase("secret", "pw");
    const header = new TextDecoder().decode(ct.slice(0, 21));
    expect(header).toBe("age-encryption.org/v1");
  });

  test("wrong passphrase rejects", async () => {
    const ct = await encryptWithPassphrase("secret", "right");
    await expect(decryptWithPassphrase(ct, "wrong")).rejects.toThrow();
  });
});
