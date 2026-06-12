import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { memoryIo } from "../../src/cli/output.ts";
import { buildProgram } from "../../src/cli/program.ts";
import type { MenvError } from "../../src/core/errors.ts";
import { loadRegistry } from "../../src/registry/persist.ts";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

// One fresh program per invocation — commander instances parse once.
async function run(root: string, args: string[]) {
  const io = memoryIo();
  const program = buildProgram(root, io);
  program.exitOverride();
  await program.parseAsync(args, { from: "user" });
  return io;
}

describe("program — end to end on a tmp repo", () => {
  test("init → vault add → consumer add → define → wire → set → get", async () => {
    const root = await tmpRepo();
    roots.push(root);
    await run(root, ["init", "--no-encrypt"]);
    await run(root, ["vault", "add", "staging", "--type", "menv-local", "--config", "filename=.menv/vault.staging.json,encryption=false"]);
    await run(root, ["consumer", "add", "api", "--strategy", "single", "--base-dir", "apps/api", "--filename", ".env"]);
    await run(root, ["var", "define", "DATABASE_URL", "--secret", "--description", "Postgres"]);
    await run(root, ["wire", "DATABASE_URL", "--vault", "local", "--consumers", "api"]);
    const set = await run(root, ["set", "DATABASE_URL", "postgres://x", "--output", "json"]);
    expect(JSON.parse(set.out.join("")).ok).toBe(true);
    const get = await run(root, ["get", "DATABASE_URL"]);
    expect(get.out.join("")).toBe("postgres://x");
    const r = await loadRegistry(root);
    expect(r.vaults.staging).toBeDefined();
    expect(r.variables.DATABASE_URL?.vaultMapping.local?.api).toBeDefined();
    const gi = await Bun.file(join(root, ".gitignore")).text();
    expect(gi).toContain("apps/api/.env"); // consumer add appended its generated path
  });

  test("set --dry-run changes nothing and leaks nothing", async () => {
    const root = await tmpRepo();
    roots.push(root);
    await run(root, ["init", "--no-encrypt"]);
    await run(root, ["consumer", "add", "api", "--strategy", "single", "--base-dir", "apps/api", "--filename", ".env"]);
    await run(root, ["var", "define", "X"]);
    await run(root, ["wire", "X", "--vault", "local", "--consumers", "api"]);
    const io = await run(root, ["set", "X", "hunter2", "--dry-run", "--output", "json"]);
    expect(io.out.join("")).not.toContain("hunter2");
    expect(await Bun.file(join(root, ".menv/vault.json")).exists()).toBe(false);
  });

  test("removing a referenced variable blocks; --force proceeds", async () => {
    const root = await tmpRepo();
    roots.push(root);
    await run(root, ["init", "--no-encrypt"]);
    await run(root, ["consumer", "add", "api", "--strategy", "single", "--base-dir", "apps/api", "--filename", ".env"]);
    await run(root, ["var", "define", "HOST"]);
    await run(root, ["var", "define", "URL"]);
    await run(root, ["wire", "HOST", "--vault", "local", "--consumers", "api"]);
    await run(root, ["wire", "URL", "--vault", "local", "--consumers", "api"]);
    await run(root, ["set", "HOST", "localhost"]);
    await run(root, ["set", "URL", "https://${HOST}/api"]);
    try {
      await run(root, ["var", "remove", "HOST"]);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("BLOCKED");
      expect((e as MenvError).message).toContain("URL");
    }
    await run(root, ["var", "remove", "HOST", "--force"]);
    expect((await loadRegistry(root)).variables.HOST).toBeUndefined();
  });

  test("enable/disable flips the mapping entry", async () => {
    const root = await tmpRepo();
    roots.push(root);
    await run(root, ["init", "--no-encrypt"]);
    await run(root, ["consumer", "add", "api", "--strategy", "single", "--base-dir", "apps/api", "--filename", ".env"]);
    await run(root, ["var", "define", "X"]);
    await run(root, ["wire", "X", "--vault", "local", "--consumers", "api"]);
    await run(root, ["disable", "X", "--vault", "local", "--consumer", "api"]);
    expect((await loadRegistry(root)).variables.X?.vaultMapping.local?.api?.disabled).toBe(true);
    await run(root, ["enable", "X", "--vault", "local", "--consumer", "api"]);
    expect((await loadRegistry(root)).variables.X?.vaultMapping.local?.api?.disabled).toBeUndefined();
  });

  test("var list/show and vault list read without vault auth", async () => {
    const registry = makeRegistry();
    registry.variables.DATABASE_URL = { groupKey: "db", secret: true, vaultMapping: { local: { api: { key: "k" } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    const list = await run(root, ["var", "list", "--output", "json"]);
    expect(JSON.parse(list.out.join("")).result.DATABASE_URL.secret).toBe(true);
    const show = await run(root, ["var", "show", "DATABASE_URL"]);
    expect(show.out.join("")).toContain("db");
    const vaults = await run(root, ["vault", "list"]);
    expect(vaults.out.join("")).toContain("local");
    expect(vaults.out.join("")).toContain("default");
  });

  test("unknown options are hard usage errors", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    try {
      await run(root, ["var", "list", "--bogus"]);
      expect.unreachable();
    } catch (e) {
      expect(String((e as { code?: string }).code)).toStartWith("commander.");
    }
  });

  test("compose bind requires the file to exist and records it", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    try {
      await run(root, ["compose", "bind", "docker-compose.yml"]);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("NOT_FOUND");
    }
    await Bun.write(join(root, "docker-compose.yml"), "services: {}\n");
    await run(root, ["compose", "bind", "docker-compose.yml"]);
    expect((await loadRegistry(root)).compose.files).toEqual(["docker-compose.yml"]);
  });

  test("compose bind git-ignores the directory's .env.compose (it carries decrypted values)", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await Bun.write(join(root, "docker-compose.yml"), "services: {}\n");
    await run(root, ["compose", "bind", "docker-compose.yml"]);
    const gi = await Bun.file(join(root, ".gitignore")).text();
    expect(gi).toContain(".env.compose");
  });

  test("import wires a dotenv file through the program surface", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await Bun.write(join(root, "legacy.env"), "API_TOKEN=t\n");
    await run(root, ["import", "legacy.env", "--consumer", "api", "--vault", "local"]);
    const r = await loadRegistry(root);
    expect(r.variables.API_TOKEN?.secret).toBe(true);
    expect(r.variables.API_TOKEN?.vaultMapping.local?.api).toBeDefined();
  });
});

// Regression: a global option placed BEFORE the subcommand (its natural spot)
// must not be greedily swallowed. A variadic --vault-auth ate the subcommand.
describe("program — global flags before the subcommand", () => {
  async function encryptedRepo() {
    const registry = makeRegistry();
    registry.vaults.local.vaultConfig = { filename: ".menv/vault.json", encryption: true };
    registry.variables.TOKEN = { vaultMapping: { local: { api: { key: "k" } } } };
    const root = await tmpRepo(registry);
    roots.push(root);
    return root;
  }

  test("--vault-auth before the subcommand reaches the action", async () => {
    const root = await encryptedRepo();
    await run(root, ["--vault-auth", "local=pw", "set", "TOKEN", "secret-v"]);
    const get = await run(root, ["get", "TOKEN", "--vault-auth", "local=pw"]);
    expect(get.out.join("")).toBe("secret-v");
  });

  test("--vault-auth is repeatable (one pair per occurrence)", async () => {
    const root = await encryptedRepo();
    // two pairs, before the subcommand: neither is swallowed
    await run(root, ["--vault-auth", "local=pw", "--vault-auth", "other=zz", "set", "TOKEN", "v2"]);
    const get = await run(root, ["get", "TOKEN", "--vault-auth", "local=pw"]);
    expect(get.out.join("")).toBe("v2");
  });
});

// Coverage the happy-path E2E suite missed — each guards a real regression
// class in the commander action wiring (review panel, test-adequacy).
describe("program — command coverage", () => {
  const readVault = async (root: string) =>
    JSON.parse(await Bun.file(join(root, ".menv/vault.json")).text()) as Record<string, string>;

  test("--dry-run on a registry-only mutator applies nothing", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    const io = await run(root, ["group", "add", "payments", "--title", "Payments", "--dry-run", "--output", "json"]);
    expect(JSON.parse(io.out.join("")).result.dryRun).toBe(true);
    expect((await loadRegistry(root)).groups.payments).toBeUndefined();
  });

  test("global define → list → remove, and the --runtime/--value XOR", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await run(root, ["global", "define", "FQDN", "--vault", "local", "--value", "localhost:3000"]);
    expect((await loadRegistry(root)).globals.FQDN?.values.local).toEqual({ source: "static", value: "localhost:3000" });
    const list = await run(root, ["global", "list", "--output", "json"]);
    expect(JSON.parse(list.out.join("")).result.FQDN).toBeDefined();
    await run(root, ["global", "remove", "FQDN"]);
    expect((await loadRegistry(root)).globals.FQDN).toBeUndefined();
    try {
      await run(root, ["global", "define", "X", "--vault", "local", "--runtime", "--value", "y"]);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("VALIDATION");
    }
  });

  test("unwire removes the mapping and the orphaned vault key's value", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await run(root, ["var", "define", "X"]);
    await run(root, ["wire", "X", "--vault", "local", "--consumers", "api"]);
    await run(root, ["set", "X", "v"]);
    const key = (await loadRegistry(root)).variables.X?.vaultMapping.local?.api?.key as string;
    await run(root, ["unwire", "X", "--vault", "local", "--consumers", "api"]);
    expect((await loadRegistry(root)).variables.X?.vaultMapping.local).toBeUndefined();
    expect((await readVault(root))[key]).toBeUndefined();
  });

  test("consumer remove drops the mapping and cleans the orphaned key", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await run(root, ["var", "define", "X"]);
    await run(root, ["wire", "X", "--vault", "local", "--consumers", "api"]);
    await run(root, ["set", "X", "v"]);
    const key = (await loadRegistry(root)).variables.X?.vaultMapping.local?.api?.key as string;
    await run(root, ["consumer", "remove", "api"]);
    const after = await loadRegistry(root);
    expect(after.consumers.api).toBeUndefined();
    expect(after.variables.X?.vaultMapping.local).toBeUndefined();
    expect((await readVault(root))[key]).toBeUndefined();
  });

  test("var update --no-secret flips secret off; no flag leaves it unchanged", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await run(root, ["var", "define", "X", "--secret"]);
    await run(root, ["var", "update", "X", "--no-secret"]);
    expect((await loadRegistry(root)).variables.X?.secret).toBe(false);
    await run(root, ["var", "update", "X", "--description", "d"]);
    expect((await loadRegistry(root)).variables.X?.secret).toBe(false); // untouched
  });

  test("consumer add --secrets-as-local-overrides --no-gitignore ignores only the .local file", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await run(root, [
      "consumer", "add", "svc",
      "--strategy", "single", "--base-dir", "apps/svc", "--filename", ".env",
      "--secrets-as-local-overrides", "--no-gitignore",
    ]);
    const gi = await Bun.file(join(root, ".gitignore")).text();
    expect(gi).toContain("apps/svc/.env.local");
    expect(gi.split("\n")).not.toContain("apps/svc/.env"); // base file not ignored under --no-gitignore
  });

  test("vault update --default lets the previous default be removed", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await run(root, ["vault", "update", "production", "--default"]);
    expect((await loadRegistry(root)).defaults.vault).toBe("production");
    await run(root, ["vault", "remove", "local"]); // no longer the default → allowed
    expect((await loadRegistry(root)).vaults.local).toBeUndefined();
  });

  test("import shared-key conflict blocks without --force, splits with it", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    await run(root, ["var", "define", "X"]);
    await run(root, ["wire", "X", "--vault", "local", "--consumers", "api,web", "--shared"]);
    await run(root, ["set", "X", "both"]);
    await Bun.write(join(root, "api.env"), "X=api-own\n");
    try {
      await run(root, ["import", "api.env", "--consumer", "api", "--vault", "local"]);
      expect.unreachable();
    } catch (e) {
      expect((e as MenvError).code).toBe("BLOCKED");
    }
    const blocked = await loadRegistry(root);
    expect(blocked.variables.X?.vaultMapping.local?.api?.key).toBe(blocked.variables.X?.vaultMapping.local?.web?.key);
    await run(root, ["import", "api.env", "--consumer", "api", "--vault", "local", "--force"]);
    const after = await loadRegistry(root);
    const apiKey = after.variables.X?.vaultMapping.local?.api?.key as string;
    const webKey = after.variables.X?.vaultMapping.local?.web?.key as string;
    expect(apiKey).not.toBe(webKey);
    const vault = await readVault(root);
    expect(vault[apiKey]).toBe("api-own");
    expect(vault[webKey]).toBe("both");
  });
});
