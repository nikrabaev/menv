import { Decrypter, Encrypter } from "age-encryption";

// Symmetric (scrypt) age encryption. This is the menv-local provider's
// optional at-rest encryption; the passphrase arrives via auth resolution.
export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<Uint8Array> {
  const e = new Encrypter();
  e.setPassphrase(passphrase);
  return await e.encrypt(plaintext);
}

export async function decryptWithPassphrase(ciphertext: Uint8Array, passphrase: string): Promise<string> {
  const d = new Decrypter();
  d.addPassphrase(passphrase);
  return await d.decrypt(ciphertext, "text");
}
