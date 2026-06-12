import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MenvError } from "../../../src/core/errors.ts";
import { localProvider } from "../../../src/vault/providers/local.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-local-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PLAIN = { filename: ".menv/vault.json", encryption: false };
const ENCRYPTED = { filename: ".menv/vault.json", encryption: true };

describe("menv-local provider", () => {
  test("declares its type", () => {
    expect(localProvider.type).toBe("menv-local");
  });

  test("plaintext: set persists immediately as readable JSON", async () => {
    const s = await localProvider.init(PLAIN, { root, auth: {} });
    await s.set("k1", "v1");
    await s.close();
    const onDisk = JSON.parse(await Bun.file(join(root, ".menv/vault.json")).text());
    expect(onDisk).toEqual({ k1: "v1" });
  });

  test("encrypted: file on disk is age ciphertext, round-trips through a new session", async () => {
    const s = await localProvider.init(ENCRYPTED, { root, auth: { secret: "pw" } });
    await s.set("k1", "v1");
    await s.close();
    const bytes = new Uint8Array(await Bun.file(join(root, ".menv/vault.json")).arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 21))).toBe("age-encryption.org/v1");
    const s2 = await localProvider.init(ENCRYPTED, { root, auth: { secret: "pw" } });
    expect(await s2.get("k1")).toBe("v1");
    await s2.close();
  });

  test("encrypted: missing auth → AUTH_MISSING", async () => {
    try {
      await localProvider.init(ENCRYPTED, { root, auth: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("AUTH_MISSING");
    }
  });

  test("encrypted: wrong passphrase on an existing vault → AUTH_FAILED", async () => {
    const s = await localProvider.init(ENCRYPTED, { root, auth: { secret: "right" } });
    await s.set("k", "v");
    await s.close();
    try {
      await localProvider.init(ENCRYPTED, { root, auth: { secret: "wrong" } });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("AUTH_FAILED");
    }
  });

  test("corrupt plaintext vault file → VAULT_IO", async () => {
    await Bun.write(join(root, ".menv/vault.json"), "not json");
    try {
      await localProvider.init(PLAIN, { root, auth: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VAULT_IO");
    }
  });

  test("bad vaultConfig → VALIDATION", async () => {
    try {
      await localProvider.init({ encryption: false }, { root, auth: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });
});
