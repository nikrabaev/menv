import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MenvError } from "../../src/core/errors.ts";
import { loadRegistry, saveRegistry } from "../../src/registry/persist.ts";
import type { Registry } from "../../src/registry/types.ts";

function makeRegistry(): Registry {
  return {
    schemaVersion: 2,
    defaults: { vault: "local" },
    vaults: { local: { vaultType: "menv-local", vaultConfig: { filename: ".menv/vault.json", encryption: false } } },
    consumers: { api: { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env" } } },
    groups: {},
    globals: {},
    variables: {},
    compose: { files: [] },
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "menv-registry-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("registry persist", () => {
  test("save → load round-trips", async () => {
    await saveRegistry(root, makeRegistry());
    const loaded = await loadRegistry(root);
    expect(loaded).toEqual(makeRegistry());
  });

  test("saves canonical 2-space JSON with trailing newline", async () => {
    await saveRegistry(root, makeRegistry());
    const text = await Bun.file(join(root, "menv.json")).text();
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('  "schemaVersion": 2');
  });

  test("missing menv.json → NOT_FOUND mentioning init", async () => {
    await expect(loadRegistry(root)).rejects.toThrow(MenvError);
    try {
      await loadRegistry(root);
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
      expect((e as MenvError).message).toContain("menv init");
    }
  });

  test("malformed JSON → PARSE", async () => {
    await Bun.write(join(root, "menv.json"), "{ nope");
    try {
      await loadRegistry(root);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("PARSE");
    }
  });

  test("invalid document → VALIDATION with issues in details", async () => {
    await Bun.write(join(root, "menv.json"), JSON.stringify({ schemaVersion: 1 }));
    try {
      await loadRegistry(root);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect(Array.isArray((e as MenvError).details)).toBe(true);
    }
  });
});
