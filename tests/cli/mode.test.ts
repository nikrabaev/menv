import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scaffold } from "./helpers.ts";
import { runMode } from "../../src/cli/mode.ts";
import { loadModel } from "../../src/cli/context.ts";

test("mode flips a consumer to per-env and persists it", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" } } });
  // A plain `.env` scaffolds as single mode.
  expect((await loadModel(root, { backend })).model.consumers.find((c) => c.id === "app:api")!.envMode).toBe("single");

  await runMode(root, "api", "perenv", { backend, stamp: "m1" });

  const { model } = await loadModel(root, { backend });
  expect(model.consumers.find((c) => c.id === "app:api")!.envMode).toBe("perenv");
  // Generation now emits a per-env file rather than the single .env.
  expect(existsSync(join(root, "apps", "api", ".env.dev"))).toBe(true);

  await runMode(root, "api", "single", { backend, stamp: "m2" });
  expect((await loadModel(root, { backend })).model.consumers.find((c) => c.id === "app:api")!.envMode).toBe("single");
});

test("mode resolves a consumer by name or id", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" } } });
  await runMode(root, "app:api", "perenv", { backend, stamp: "m1" });
  expect((await loadModel(root, { backend })).model.consumers.find((c) => c.id === "app:api")!.envMode).toBe("perenv");
});
