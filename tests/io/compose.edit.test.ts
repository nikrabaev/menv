import { expect, test } from "bun:test";
import { ensureServiceEnvFile } from "../../src/io/compose.ts";

const yml = `# my stack
services:
  api:
    image: node # the api
`;

test("adds env_file entry and preserves comments", () => {
  const out = ensureServiceEnvFile(yml, "api", "./apps/api/.env");
  expect(out).toContain("# my stack");
  expect(out).toContain("# the api");
  expect(out).toContain("./apps/api/.env");
});

test("is idempotent", () => {
  const once = ensureServiceEnvFile(yml, "api", "./apps/api/.env");
  const twice = ensureServiceEnvFile(once, "api", "./apps/api/.env");
  expect(twice).toBe(once);
});
