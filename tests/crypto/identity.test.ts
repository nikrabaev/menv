import { expect, test } from "bun:test";
import { loadOrCreateIdentity, type KeyBackend } from "../../src/crypto/identity.ts";

function memBackend(): KeyBackend {
  let stored: string | null = null;
  return {
    async get() { return stored; },
    async set(v) { stored = v; },
  };
}

test("creates an identity on first call and returns it thereafter", async () => {
  const backend = memBackend();
  const first = await loadOrCreateIdentity(backend);
  expect(first.identity.startsWith("AGE-SECRET-KEY-1")).toBe(true);
  const second = await loadOrCreateIdentity(backend);
  expect(second.identity).toBe(first.identity);
  expect(second.recipient).toBe(first.recipient);
});
