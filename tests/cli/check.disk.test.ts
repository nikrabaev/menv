import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runCheck } from "../../src/cli/check.ts";
import { runGenerate } from "../../src/cli/generate.ts";
import { memoryIo } from "../../src/cli/output.ts";
import { openVaultSession } from "../../src/cli/run.ts";
import type { MenvError } from "../../src/core/errors.ts";
import type { Registry } from "../../src/registry/types.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const FLAGS = { dryRun: false, force: false, mode: "json" as const, vaultAuth: {}, env: {} };

// Called directly (not via the entry point), runCheck EMITS the ok envelope on
// success but THROWS on errors — findings ride on the MenvError's `details`.
function passedFindings(io: ReturnType<typeof memoryIo>): string[] {
  return (JSON.parse(io.out.join("")).result.findings as { code: string }[]).map((f) => f.code);
}
function failedFindings(e: unknown): string[] {
  return ((e as MenvError).details as { code: string }[]).map((f) => f.code);
}

async function repo(): Promise<{ root: string; registry: Registry }> {
  const registry = makeRegistry();
  registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k-port" } } } } };
  const root = await tmpRepo(registry);
  roots.push(root);
  const s = await openVaultSession(root, registry, "local", FLAGS);
  await s.set("k-port", "3000");
  await s.close();
  return { root, registry };
}

describe("runCheck", () => {
  test("a freshly generated repo passes (exit 0)", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const io = memoryIo();
    await runCheck(root, registry, FLAGS, io); // resolves = exit 0
    const env = JSON.parse(io.out.join(""));
    expect(env.ok).toBe(true);
    expect(passedFindings(io)).not.toContain("STALE");
  });

  test("a hand-edited generated file is STALE", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    const cur = await Bun.file(join(root, "apps/api/.env")).text();
    await Bun.write(join(root, "apps/api/.env"), `${cur}EXTRA=1\n`);
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect(failedFindings(e)).toContain("STALE");
    }
  });

  test("a foreign file at an expected path is FOREIGN_FILE", async () => {
    const { root, registry } = await repo();
    await Bun.write(join(root, "apps/api/.env"), "HAND=made\n");
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("FOREIGN_FILE");
    }
  });

  test("an unresolved interpolation reference is INTERPOLATION", async () => {
    const { root, registry } = await repo();
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-port", "${GHOST}");
    await s.close();
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("INTERPOLATION");
    }
  });

  test("a broken ref with an existing generated file still returns the findings list", async () => {
    const { root, registry } = await repo();
    await runGenerate(root, registry, {}, FLAGS, memoryIo()); // marked apps/api/.env on disk
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-port", "${GHOST}"); // now unresolved — the staleness preview would re-throw
    await s.close();
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect(Array.isArray((e as MenvError).details)).toBe(true); // findings preserved, not a bare throw
      expect(failedFindings(e)).toContain("INTERPOLATION");
    }
  });

  test("a compose marker naming an unknown consumer is COMPOSE_UNKNOWN_CONSUMER", async () => {
    const { root, registry } = await repo();
    registry.compose = { files: ["docker-compose.yml"] }; // runCheck reads the passed registry
    await Bun.write(join(root, "docker-compose.yml"), "x:\n  # <menv:ghost>\n  # </menv>\n");
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("COMPOSE_UNKNOWN_CONSUMER");
    }
  });
});

async function gitInitAdd(root: string, paths: string[]): Promise<void> {
  const run = async (...args: string[]): Promise<void> => {
    await Bun.spawn(["git", "-C", root, ...args], { stdout: "ignore", stderr: "ignore" }).exited;
  };
  await run("init");
  await run("config", "core.quotepath", "true"); // force quoting so the non-ASCII guard is host-independent
  await run("add", "-f", ...paths);
}

describe("runCheck — staleness vault selection", () => {
  test("a drifted .env.example is STALE even when the consumer omits the default vault", async () => {
    const registry = makeRegistry();
    // per-vault consumer with NO target in defaults.vault (local) — only production.
    registry.consumers = {
      web: {
        strategyType: "per-vault",
        strategyConfig: { baseDir: "apps/web", filenames: { production: ".env.production" }, example: true },
      },
    };
    registry.variables = { TOKEN: { vaultMapping: { production: { web: { key: "k-tok" } } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "production", FLAGS);
    await s.set("k-tok", "t");
    await s.close();
    await runGenerate(root, registry, { vault: "production" }, FLAGS, memoryIo()); // writes apps/web/.env.example
    const examplePath = join(root, "apps/web/.env.example");
    await Bun.write(examplePath, `${await Bun.file(examplePath).text()}INJECTED_DRIFT=\n`); // marker intact
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("STALE");
    }
  });

  test("generate --vault production then check reports no STALE (judged against the recorded vault)", async () => {
    const registry = makeRegistry();
    registry.consumers = { api: { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env" } } };
    registry.variables = { GREETING: { vaultMapping: { local: { api: { key: "k" } }, production: { api: { key: "k" } } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const local = await openVaultSession(root, registry, "local", FLAGS);
    await local.set("k", "hello-local");
    await local.close();
    const prod = await openVaultSession(root, registry, "production", FLAGS);
    await prod.set("k", "hello-prod");
    await prod.close();
    await runGenerate(root, registry, { vault: "production" }, FLAGS, memoryIo()); // header records vault:production
    const io = memoryIo();
    await runCheck(root, registry, FLAGS, io); // regen against production matches → not stale vs local
    expect(passedFindings(io)).not.toContain("STALE");
  });

  test("a broken ref in a file's recorded non-default vault still fails the gate", async () => {
    const registry = makeRegistry();
    registry.consumers = { api: { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env" } } };
    registry.variables = { GREETING: { vaultMapping: { local: { api: { key: "k-l" } }, production: { api: { key: "k-p" } } } } };
    const root = await tmpRepo(registry); // defaults.vault = local
    roots.push(root);
    const local = await openVaultSession(root, registry, "local", FLAGS);
    await local.set("k-l", "ok"); // default vault is clean
    await local.close();
    const prod = await openVaultSession(root, registry, "production", FLAGS);
    await prod.set("k-p", "fine");
    await prod.close();
    await runGenerate(root, registry, { vault: "production" }, FLAGS, memoryIo()); // file header records production
    const prod2 = await openVaultSession(root, registry, "production", FLAGS);
    await prod2.set("k-p", "${NONEXISTENT}"); // now broken — only in the recorded (non-default) vault
    await prod2.close();
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable(); // generate --vault production would throw, so check must not pass
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
      expect(failedFindings(e)).toContain("INTERPOLATION");
    }
  });
});

describe("runCheck — orphaned keys", () => {
  test("a vault key referenced by no variable is an ORPHANED_KEY warning (gate still passes)", async () => {
    const registry = makeRegistry();
    registry.variables = { PORT: { vaultMapping: { local: { api: { key: "k-port" } } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-port", "3000");
    await s.set("k-orphan", "leftover"); // no variable references this key
    await s.close();
    const io = memoryIo();
    await runCheck(root, registry, FLAGS, io); // warning only → resolves (exit 0)
    const codes = passedFindings(io);
    expect(codes).toContain("ORPHANED_KEY");
    expect(codes).not.toContain("MISSING_VALUE"); // k-port is set, so no false orphan/missing noise
  });
});

describe("runCheck — git-tracking gate", () => {
  test("PLAINTEXT_VAULT_TRACKED fires when a plaintext vault file is git-tracked", async () => {
    const { root, registry } = await repo(); // local vault is encryption:false → .menv/vault.json
    await gitInitAdd(root, [".menv/vault.json"]);
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("PLAINTEXT_VAULT_TRACKED");
    }
  });

  test("SECRET_FILE_TRACKED fires when a secret-bearing generated file is tracked", async () => {
    const registry = makeRegistry();
    registry.variables = { TOKEN: { secret: true, vaultMapping: { local: { api: { key: "k-tok" } } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-tok", "supersecret");
    await s.close();
    await runGenerate(root, registry, {}, FLAGS, memoryIo()); // apps/api/.env carries TOKEN (no split)
    await gitInitAdd(root, ["apps/api/.env"]);
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("SECRET_FILE_TRACKED");
    }
  });

  test("with secrets split, the tracked .env.local is the flagged secret file", async () => {
    const registry = makeRegistry();
    registry.consumers.api = {
      strategyType: "single",
      strategyConfig: { baseDir: "apps/api", filename: ".env", secretsAsLocalOverrides: true },
    };
    registry.variables = {
      TOKEN: { secret: true, vaultMapping: { local: { api: { key: "k-tok" } } } },
      PORT: { vaultMapping: { local: { api: { key: "k-port" } } } },
    };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-tok", "supersecret");
    await s.set("k-port", "3000");
    await s.close();
    await runGenerate(root, registry, {}, FLAGS, memoryIo()); // .env (PORT) + .env.local (TOKEN)
    await gitInitAdd(root, ["apps/api/.env.local"]); // only the secret companion is tracked
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      const details = (e as MenvError).details as { code: string; message: string }[];
      expect(details.find((f) => f.code === "SECRET_FILE_TRACKED")?.message).toContain(".env.local");
    }
  });

  test("a tracked secret file at a non-ASCII path is still flagged (git quotes it)", async () => {
    const registry = makeRegistry();
    registry.consumers.api = { strategyType: "single", strategyConfig: { baseDir: "apps/api", filename: ".env.café" } };
    registry.variables = { TOKEN: { secret: true, vaultMapping: { local: { api: { key: "k-tok" } } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const s = await openVaultSession(root, registry, "local", FLAGS);
    await s.set("k-tok", "supersecret");
    await s.close();
    await runGenerate(root, registry, {}, FLAGS, memoryIo());
    await gitInitAdd(root, ["apps/api/.env.café"]);
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("SECRET_FILE_TRACKED");
    }
  });

  test("a tracked .env.compose for a bound file is flagged", async () => {
    const registry = makeRegistry();
    registry.compose = { files: ["docker-compose.yml"] };
    const root = await tmpRepo(registry);
    roots.push(root);
    await Bun.write(join(root, "docker-compose.yml"), "services: {}\n");
    await Bun.write(join(root, ".env.compose"), "API_X=secret\n");
    await gitInitAdd(root, [".env.compose"]);
    try {
      await runCheck(root, registry, FLAGS, memoryIo());
      expect.unreachable();
    } catch (e) {
      expect(failedFindings(e)).toContain("SECRET_FILE_TRACKED");
    }
  });
});
