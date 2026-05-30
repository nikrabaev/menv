import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeypair } from "../../src/crypto/age.ts";
import { saveEnvValues, loadEnvValues } from "../../src/crypto/vault.ts";

test("saves and loads encrypted values for an env by var name", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const { identity, recipient } = await generateKeypair();
  await saveEnvValues(root, "dev", { DATABASE_URL: "pg://x", PORT: "3000" }, [recipient]);
  const got = await loadEnvValues(root, "dev", identity);
  expect(got).toEqual({ DATABASE_URL: "pg://x", PORT: "3000" });
});

test("returns empty object when the env file is absent", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const { identity } = await generateKeypair();
  expect(await loadEnvValues(root, "prod", identity)).toEqual({});
});
