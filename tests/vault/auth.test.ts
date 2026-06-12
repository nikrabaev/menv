import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MenvError } from "../../src/core/errors.ts";
import { authEnvVarName, resolveVaultAuth } from "../../src/vault/auth.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-auth-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeAuthFile(entries: Record<string, unknown>): Promise<void> {
  await Bun.write(join(root, ".menv/auth.local.json"), JSON.stringify(entries));
}

describe("authEnvVarName", () => {
  test("uppercases and replaces non-alphanumerics", () => {
    expect(authEnvVarName("local")).toBe("MENV_VAULT_AUTH_LOCAL");
    expect(authEnvVarName("prod-eu.1")).toBe("MENV_VAULT_AUTH_PROD_EU_1");
  });
});

describe("resolveVaultAuth", () => {
  test("precedence: flag beats env beats file", async () => {
    await writeAuthFile({ local: { type: "value", value: "from-file" } });
    const auth = await resolveVaultAuth("local", {
      root,
      flag: "from-flag",
      env: { MENV_VAULT_AUTH_LOCAL: "from-env" },
    });
    expect(auth.secret).toBe("from-flag");
    const auth2 = await resolveVaultAuth("local", { root, env: { MENV_VAULT_AUTH_LOCAL: "from-env" } });
    expect(auth2.secret).toBe("from-env");
    const auth3 = await resolveVaultAuth("local", { root, env: {} });
    expect(auth3.secret).toBe("from-file");
  });

  test("auth file: env-type entry reads the named variable", async () => {
    await writeAuthFile({ local: { type: "env", name: "MY_KEY" } });
    const auth = await resolveVaultAuth("local", { root, env: { MY_KEY: "indirect" } });
    expect(auth.secret).toBe("indirect");
  });

  test("auth file: command-type entry runs the command and trims stdout", async () => {
    await writeAuthFile({ local: { type: "command", command: "printf 'cmd-secret\\n'" } });
    const auth = await resolveVaultAuth("local", { root, env: {} });
    expect(auth.secret).toBe("cmd-secret");
  });

  test("auth file: failing command → AUTH_FAILED", async () => {
    await writeAuthFile({ local: { type: "command", command: "exit 7" } });
    try {
      await resolveVaultAuth("local", { root, env: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("AUTH_FAILED");
    }
  });

  test("prompt is used last, only when provided", async () => {
    const auth = await resolveVaultAuth("local", {
      root,
      env: {},
      promptFn: async () => "typed",
    });
    expect(auth.secret).toBe("typed");
  });

  test("nothing available → AUTH_MISSING listing all four supply paths", async () => {
    try {
      await resolveVaultAuth("local", { root, env: {} });
      expect.unreachable();
    } catch (e) {
      const err = e as MenvError;
      expect(err.code).toBe("AUTH_MISSING");
      expect(err.message).toContain("--vault-auth");
      expect(err.message).toContain("MENV_VAULT_AUTH_LOCAL");
      expect(err.message).toContain(".menv/auth.local.json");
    }
  });
});
