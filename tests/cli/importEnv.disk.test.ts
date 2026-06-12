import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runImport } from "../../src/cli/importEnv.ts";
import { memoryIo } from "../../src/cli/output.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { loadRegistry } from "../../src/registry/persist.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

describe("runImport", () => {
  test("imports a dotenv file end to end", async () => {
    const registry = makeRegistry();
    const root = await tmpRepo(registry);
    roots.push(root);
    await Bun.write(join(root, "old.env"), "# c\nAPI_TOKEN=tok\nPORT=3000\n");
    const io = memoryIo();
    await runImport(root, registry, { file: "old.env", consumer: "api", vault: "local" }, FLAGS, io);
    const saved = await loadRegistry(root);
    expect(saved.variables.API_TOKEN?.secret).toBe(true);
    const key = saved.variables.PORT?.vaultMapping.local?.api?.key as string;
    const s = await openVaultSession(root, saved, "local", FLAGS);
    expect(await s.get(key)).toBe("3000");
    await s.close();
    const envelope = JSON.parse(io.out.join(""));
    expect(envelope.result.report.defined.sort()).toEqual(["API_TOKEN", "PORT"]);
    expect(io.out.join("")).not.toContain("tok"); // values stay out of the report/plan
  });

  test("missing file → NOT_FOUND", async () => {
    const registry = makeRegistry();
    const root = await tmpRepo(registry);
    roots.push(root);
    try {
      await runImport(root, registry, { file: "nope.env", consumer: "api", vault: "local" }, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
  });
});
