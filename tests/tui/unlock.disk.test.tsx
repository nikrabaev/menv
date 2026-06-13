// Encrypted-vault behavior: locked badges, the masked unlock modal (wrong and
// right passphrase), and in-memory-only auth.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Registry } from "../../src/registry/types.ts";
import { getProvider } from "../../src/vault/registry.ts";
import { ENTER, renderApp, tick, tuiRegistry } from "./helpers.tsx";

async function encryptedFixture(): Promise<Registry> {
  const registry = tuiRegistry();
  registry.vaults.local = {
    vaultType: "menv-local",
    vaultConfig: { filename: ".menv/vault.enc.json", encryption: true },
  };
  return registry;
}

// One set = one scrypt round; keep the fixture to a single write (age work
// factors dominate these tests' wall-clock).
async function writeEncryptedVault(root: string, passphrase: string): Promise<void> {
  const session = await getProvider("menv-local").init(
    { filename: ".menv/vault.enc.json", encryption: true },
    { root, auth: { secret: passphrase } },
  );
  await session.set("k-db", "postgres://enc@host/db");
  await session.close();
}

describe("locked vaults", () => {
  test("locked badge + masked values; unlock with wrong then right passphrase", async () => {
    const registry = await encryptedFixture();
    const rig = await renderApp(registry, {});
    await writeEncryptedVault(rig.root, "hunter2");
    await rig.type("R"); // reload now that the encrypted file exists
    await tick(200);
    expect(rig.frame()).toContain("LOCKED");
    expect(rig.frame()).toContain("locked (u)"); // inspector value column

    await rig.type("1"); // sidebar (local selected)
    await rig.type("u");
    expect(rig.frame()).toContain('Unlock vault "local"');
    await rig.type("wrong-pass");
    await rig.type(ENTER);
    await tick(300);
    expect(rig.frame()).toContain("could not decrypt");

    await rig.type("hunter2");
    await rig.type(ENTER);
    await tick(400);
    const frame = rig.frame();
    expect(frame).toContain("unlocked");
    expect(frame).not.toContain('Unlock vault "local"');
    // passphrase lives in the session auth map only
    expect(rig.ctx.auth.get("local")).toBe("hunter2");
    const files = await Array.fromAsync(new Bun.Glob("**/auth*").scan({ cwd: join(rig.root, ".menv") }));
    expect(files).toEqual([]); // never persisted
    rig.ui.unmount();
  }, 30000);

  test("generate against a locked vault asks to unlock first", async () => {
    const registry = await encryptedFixture();
    const rig = await renderApp(registry, {});
    await writeEncryptedVault(rig.root, "pw");
    await rig.type("R");
    await tick(200);
    await rig.type("g");
    expect(rig.frame()).toContain('Unlock vault "local"');
    await rig.type("pw");
    await rig.type(ENTER);
    await tick(400);
    expect(rig.frame()).toContain("would write");
    rig.ui.unmount();
  }, 30000);
});
