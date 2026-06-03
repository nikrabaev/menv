import { expect, test } from "bun:test";
import {
  classifyFindExitCode,
  type KeyBackend,
  loadOrCreateIdentity,
} from "../../src/crypto/identity.ts";

function memBackend(): KeyBackend {
  let stored: string | null = null;
  return {
    async get() { return stored; },
    async set(v) { stored = v; return { kind: "keychain" }; },
  };
}

test("classifyFindExitCode maps exit 0 to found", () => {
  expect(classifyFindExitCode(0)).toBe("found");
});

test("classifyFindExitCode maps exit 44 to not-found", () => {
  expect(classifyFindExitCode(44)).toBe("not-found");
});

test("classifyFindExitCode maps any other non-zero exit to error", () => {
  expect(classifyFindExitCode(1)).toBe("error");
  expect(classifyFindExitCode(36)).toBe("error");
  expect(classifyFindExitCode(255)).toBe("error");
});

test("creates an identity on first call and returns it thereafter", async () => {
  const backend = memBackend();
  const first = await loadOrCreateIdentity(backend);
  expect(first.identity.startsWith("AGE-SECRET-KEY-1")).toBe(true);
  const second = await loadOrCreateIdentity(backend);
  expect(second.identity).toBe(first.identity);
  expect(second.recipient).toBe(first.recipient);
});
