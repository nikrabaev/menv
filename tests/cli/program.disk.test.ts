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
