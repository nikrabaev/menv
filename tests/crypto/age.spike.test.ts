import { expect, test } from "bun:test";
import { Encrypter, Decrypter, generateIdentity, identityToRecipient } from "age-encryption";

test("age round-trips a string", async () => {
  const id = await generateIdentity();
  const recipient = await identityToRecipient(id);

  const e = new Encrypter();
  e.addRecipient(recipient);
  const ct = await e.encrypt("hello");

  const d = new Decrypter();
  d.addIdentity(id);
  const pt = await d.decrypt(ct, "text");
  expect(pt).toBe("hello");
});
