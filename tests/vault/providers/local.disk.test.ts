import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MenvError } from "../../../src/core/errors.ts";
import { encryptWithPassphrase } from "../../../src/vault/age.ts";
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

  // Regression: a key named like an Object internal (e.g. "__proto__") must be
  // stored as ordinary data, not silently dropped via the prototype setter.
  // Such keys are reachable through `--key` / `import` in later plans.
  test("stores prototype-named keys (__proto__, constructor) as ordinary data", async () => {
    const s = await localProvider.init(PLAIN, { root, auth: {} });
    await s.set("__proto__", "secret-value");
    await s.set("constructor", "c");
    await s.set("NORMAL", "ok");
    await s.close();
    const onDisk = JSON.parse(await Bun.file(join(root, ".menv/vault.json")).text());
    expect(onDisk.__proto__).toBe("secret-value");
    const s2 = await localProvider.init(PLAIN, { root, auth: {} });
    expect(await s2.get("__proto__")).toBe("secret-value");
    expect(await s2.get("constructor")).toBe("c");
    expect(await s2.list()).toEqual(["NORMAL", "__proto__", "constructor"]);
    await s2.close();
  });

  test("get on a prototype-named key in an empty store is undefined", async () => {
    const s = await localProvider.init(PLAIN, { root, auth: {} });
    expect(await s.get("__proto__")).toBeUndefined();
    await s.close();
  });

  // Regression: a failed write must surface as VAULT_IO (exit-4 contract) and
  // must not leave the session reporting a value that never reached disk.
  test("plaintext: a failed write throws VAULT_IO and rolls back the in-memory value", async () => {
    const dir = join(root, "ro");
    const cfg = { filename: "vault.json", encryption: false };
    const s = await localProvider.init(cfg, { root: dir, auth: {} });
    await s.set("OK", "1");
    await chmod(dir, 0o500); // read-only dir: the next atomic write cannot create its tmp file
    try {
      try {
        await s.set("FAIL", "2");
        expect.unreachable();
      } catch (e) {
        expect((e as MenvError).code).toBe("VAULT_IO");
      }
      expect(await s.get("FAIL")).toBeUndefined();
      expect(await s.list()).toEqual(["OK"]);
    } finally {
      await chmod(dir, 0o700); // restore so afterEach can clean up
    }
    await s.close();
  });

  test("encrypted: decrypts but content is not a JSON object → VAULT_IO", async () => {
    const ct = await encryptWithPassphrase("not json", "pw");
    await Bun.write(join(root, ".menv/vault.json"), ct);
    try {
      await localProvider.init(ENCRYPTED, { root, auth: { secret: "pw" } });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VAULT_IO");
    }
  });
});

import { runVaultConformance } from "../conformance.ts";

runVaultConformance({
  label: "menv-local (plaintext)",
  async create() {
    const dir = await mkdtemp(join(tmpdir(), "menv-conf-plain-"));
    return {
      open: () => localProvider.init({ filename: "vault.json", encryption: false }, { root: dir, auth: {} }),
    };
  },
});

runVaultConformance({
  label: "menv-local (encrypted)",
  async create() {
    const dir = await mkdtemp(join(tmpdir(), "menv-conf-enc-"));
    return {
      open: () =>
        localProvider.init({ filename: "vault.json", encryption: true }, { root: dir, auth: { secret: "pw" } }),
    };
  },
});
