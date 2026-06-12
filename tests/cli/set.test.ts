import { expect, test } from "bun:test";
import { join } from "node:path";
import { runDefine } from "../../src/cli/define.ts";
import { runGet } from "../../src/cli/get.ts";
import { runSet } from "../../src/cli/set.ts";
import { scaffold } from "./helpers.ts";

test("set then get round-trips a value in the default env", async () => {
  const { root, backend } = await scaffold();
  await runSet(root, "PORT", { backend, value: "4000", stamp: "s" });
  expect(await runGet(root, "PORT", { backend })).toBe("4000");
});

test("set without --env materializes the new value into the generated .env", async () => {
  const { root, backend } = await scaffold();
  await runSet(root, "PORT", { backend, value: "4000", stamp: "s" });
  expect(await Bun.file(join(root, "apps/api/.env")).text()).toContain("PORT=4000");
});

test("set --env writes the vault only — a single-mode .env keeps the default env's values", async () => {
  // api stays single-mode (plain .env only); worker's .env.production makes the
  // "production" environment exist globally (worker itself goes per-env).
  const { root, backend } = await scaffold({
    apps: { api: { PORT: "3000" }, worker: { QUEUE: "local" } },
    extraFiles: { "apps/worker/.env.production": "QUEUE=sqs\n" },
  });
  await runSet(root, "PORT", { backend, env: "production", value: "8080", stamp: "s" });
  expect(await runGet(root, "PORT", { backend, env: "production" })).toBe("8080");
  const envFile = await Bun.file(join(root, "apps/api/.env")).text();
  expect(envFile).toContain("PORT=3000"); // still the default (dev) value
  expect(envFile).not.toContain("8080");
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

test("--local addresses the override independently of the base value", async () => {
  const { root, backend } = await scaffold({ apps: { api: { API_URL: "https://prod" } } });
  await runDefine(root, "API_URL", { backend, local: true, scope: ["api"], stamp: "s1" });
  await runSet(root, "API_URL", { backend, local: true, value: "https://dev-override", stamp: "s2" });

  expect(await runGet(root, "API_URL", { backend })).toBe("https://prod"); // base
  expect(await runGet(root, "API_URL", { backend, local: true })).toBe("https://dev-override"); // override
});
