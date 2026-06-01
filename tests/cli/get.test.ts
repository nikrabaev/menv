import { expect, test } from "bun:test";
import { scaffold } from "./helpers.ts";
import { runDefine } from "../../src/cli/define.ts";
import { runSet } from "../../src/cli/set.ts";
import { runGet } from "../../src/cli/get.ts";

test("get prints a secret's real value (so it can be piped)", async () => {
  const { root, backend } = await scaffold();
  await runDefine(root, "TOKEN", { backend, secret: true, scope: ["api"], stamp: "s1" });
  await runSet(root, "TOKEN", { backend, value: "supersecret", stamp: "s2" });
  expect(await runGet(root, "TOKEN", { backend })).toBe("supersecret");
});

test("get returns an empty string for a defined-but-unset value", async () => {
  const { root, backend } = await scaffold();
  await runDefine(root, "EMPTY", { backend, scope: ["api"], stamp: "s" });
  expect(await runGet(root, "EMPTY", { backend })).toBe("");
});

test("get errors on an unknown variable", async () => {
  const { root, backend } = await scaffold();
  expect(runGet(root, "MISSING", { backend })).rejects.toThrow(/no variable named/);
});

test("get --scope disambiguates a repeated name", async () => {
  const { root, backend } = await scaffold({ apps: { api: { NODE_ENV: "development" }, web: { NODE_ENV: "production" } } });
  expect(await runGet(root, "NODE_ENV", { backend, scope: "api" })).toBe("development");
  expect(await runGet(root, "NODE_ENV", { backend, scope: "web" })).toBe("production");
  // Without a scope, the repeated name is ambiguous.
  expect(runGet(root, "NODE_ENV", { backend })).rejects.toThrow(/ambiguous/);
});
