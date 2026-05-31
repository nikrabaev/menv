import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from "age-encryption";

export interface Keypair {
  identity: string; // AGE-SECRET-KEY-1...
  recipient: string; // age1...
}

export async function generateKeypair(): Promise<Keypair> {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  return { identity, recipient };
}

export async function recipientFromIdentity(identity: string): Promise<string> {
  return await identityToRecipient(identity);
}

export async function encryptToRecipients(plaintext: string, recipients: string[]): Promise<Uint8Array> {
  const e = new Encrypter();
  for (const r of recipients) e.addRecipient(r);
  return await e.encrypt(plaintext);
}

export async function decryptWithIdentity(ciphertext: Uint8Array, identity: string): Promise<string> {
  const d = new Decrypter();
  d.addIdentity(identity);
  return await d.decrypt(ciphertext, "text");
}

// Symmetric (scrypt) encryption, used by the password backend to protect the age
// identity itself under a user passphrase. Distinct from the recipient-based
// encryption above, which protects the env values.
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
