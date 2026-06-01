import { expect, test } from "bun:test";
import { scaffold } from "./helpers.ts";
import { runSet } from "../../src/cli/set.ts";
import { runGet } from "../../src/cli/get.ts";

test("set then get round-trips a value in the default env", async () => {
  const { root, backend } = await scaffold();
  await runSet(root, "PORT", { backend, value: "4000", stamp: "s" });
  expect(await runGet(root, "PORT", { backend })).toBe("4000");
});

test("set --env targets a specific environment, leaving others untouched", async () => {
  const { root, backend } = await scaffold({
    apps: { api: { PORT: "3000" } },
    extraFiles: { "apps/api/.env.production": "PORT=8080\n" },
  });
  await runSet(root, "PORT", { backend, env: "production", value: "9090", stamp: "s" });
  expect(await runGet(root, "PORT", { backend, env: "production" })).toBe("9090");
  expect(await runGet(root, "PORT", { backend })).toBe("3000"); // dev unchanged
});

test("set errors when the variable is not defined", async () => {
  const { root, backend } = await scaffold();
  expect(runSet(root, "MISSING", { backend, value: "x", stamp: "s" })).rejects.toThrow(/no variable named/);
});

test("set rejects an unknown --env", async () => {
  const { root, backend } = await scaffold();
  expect(runSet(root, "PORT", { backend, env: "nope", value: "x", stamp: "s" })).rejects.toThrow(/unknown environment/);
});
