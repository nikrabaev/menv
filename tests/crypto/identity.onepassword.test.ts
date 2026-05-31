import { expect, test } from "bun:test";
import { onePasswordBackend, type OpExec, type OpResult } from "../../src/crypto/identity.ts";

const IDENTITY = "AGE-SECRET-KEY-1EXAMPLE";

// A fake `op` that records its invocations and serves canned responses.
function fakeOp(handler: (args: string[]) => OpResult): { exec: OpExec; calls: string[][] } {
  const calls: string[][] = [];
  return { calls, exec: async (args) => { calls.push(args); return handler(args); } };
}

test("set creates an item, parses its id, and returns an op:// reference", async () => {
  const op = fakeOp((args) => {
    if (args[0] === "item" && args[1] === "create") return { code: 0, stdout: JSON.stringify({ id: "abc123" }), stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
  const backend = onePasswordBackend({ vault: "Dev", title: "menv", exec: op.exec });
  const cfg = await backend.set(IDENTITY);
  expect(cfg).toEqual({ kind: "1password", opRef: "op://Dev/abc123/password" });
  const create = op.calls.find((c) => c[1] === "create")!;
  expect(create).toContain("--vault");
  expect(create).toContain("Dev");
  expect(create).toContain(`password=${IDENTITY}`);
});

test("set defaults to the Private vault", async () => {
  const op = fakeOp(() => ({ code: 0, stdout: JSON.stringify({ id: "xyz" }), stderr: "" }));
  const backend = onePasswordBackend({ exec: op.exec });
  const cfg = await backend.set(IDENTITY);
  expect(cfg.opRef).toBe("op://Private/xyz/password");
});

test("get reads the identity from the reference", async () => {
  const op = fakeOp((args) => {
    if (args[0] === "read") return { code: 0, stdout: `${IDENTITY}\n`, stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
  const backend = onePasswordBackend({ ref: "op://Dev/abc123/password", exec: op.exec });
  expect(await backend.get()).toBe(IDENTITY);
  expect(op.calls[0]).toEqual(["read", "op://Dev/abc123/password"]);
});

test("get returns null when there is no reference yet", async () => {
  const op = fakeOp(() => ({ code: 1, stdout: "", stderr: "should not be called" }));
  const backend = onePasswordBackend({ exec: op.exec });
  expect(await backend.get()).toBeNull();
  expect(op.calls.length).toBe(0);
});

test("a missing op binary surfaces an install hint", async () => {
  const exec: OpExec = async () => ({ code: 127, stdout: "", stderr: "op: command not found" });
  const backend = onePasswordBackend({ ref: "op://a/b/password", exec });
  expect(backend.get()).rejects.toThrow(/not found/i);
});

test("a signed-out op surfaces a signin hint", async () => {
  const exec: OpExec = async () => ({ code: 1, stdout: "", stderr: "[ERROR] you are not currently signed in" });
  const backend = onePasswordBackend({ ref: "op://a/b/password", exec });
  expect(backend.get()).rejects.toThrow(/signin|signed in/i);
});
