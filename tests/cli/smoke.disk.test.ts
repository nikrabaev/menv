import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { makeRegistry, tmpRepo } from "../helpers/fixtures.ts";

const INDEX = join(import.meta.dir, "../../src/index.ts");
const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

async function menv(cwd: string, args: string[], envOverrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, ...envOverrides };
  const proc = Bun.spawn(["bun", INDEX, ...args], { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout, stderr };
}

describe("menv binary smoke (exit-code contract)", () => {
  test("--help exits 0; bare invocation prints help and exits 0", async () => {
    const root = await tmpRepo();
    roots.push(root);
    const help = await menv(root, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("menv");
    expect((await menv(root, [])).code).toBe(0);
  });

  test("unknown command/option → exit 2", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    expect((await menv(root, ["frobnicate"])).code).toBe(2);
    expect((await menv(root, ["var", "list", "--bogus"])).code).toBe(2);
  });

  test("domain error → exit 1, json envelope on stdout when asked", async () => {
    const root = await tmpRepo(); // no menv.json → NOT_FOUND
    roots.push(root);
    const r = await menv(root, ["var", "list", "--output", "json"]);
    expect(r.code).toBe(1);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("NOT_FOUND");
  });

  test("auth contract: encrypted vault, no TTY, no auth → exit 3; env auth → exit 0", async () => {
    const root = await tmpRepo();
    roots.push(root);
    expect((await menv(root, ["init"])).code).toBe(0); // default --encrypt
    await menv(root, ["consumer", "add", "api", "--strategy", "single", "--base-dir", "apps/api", "--filename", ".env"]);
    await menv(root, ["var", "define", "TOKEN"]);
    await menv(root, ["wire", "TOKEN", "--vault", "local", "--consumers", "api"]);
    const noAuth = await menv(root, ["set", "TOKEN", "v"], { MENV_VAULT_AUTH_LOCAL: undefined });
    expect(noAuth.code).toBe(3);
    const withAuth = await menv(root, ["set", "TOKEN", "v"], { MENV_VAULT_AUTH_LOCAL: "pw" });
    expect(withAuth.code).toBe(0);
    const get = await menv(root, ["get", "TOKEN"], { MENV_VAULT_AUTH_LOCAL: "pw" });
    expect(get.code).toBe(0);
    expect(get.stdout).toBe("v");
  });

  test("works from a nested directory (findRoot walks up)", async () => {
    const root = await tmpRepo(makeRegistry());
    roots.push(root);
    const nested = join(root, "apps/api");
    await Bun.write(join(nested, ".keep"), "");
    const r = await menv(nested, ["vault", "list"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("local");
  });
});
