import { expect, test } from "bun:test";
import { scaffold } from "./helpers.ts";
import { runWire, runUnwire } from "../../src/cli/wire.ts";
import { runRm } from "../../src/cli/rm.ts";
import { runGet } from "../../src/cli/get.ts";
import { loadModel } from "../../src/cli/context.ts";
import type { KeyBackend } from "../../src/crypto/identity.ts";

const consumersOf = async (root: string, backend: KeyBackend, name: string) => {
  const { model } = await loadModel(root, { backend });
  return model.variables.find((v) => v.name === name)!.consumers.slice().sort();
};

test("wire adds consumers (including the root target) and unwire removes them", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" } } });
  await runWire(root, "PORT", ["root"], { backend, stamp: "s1" });
  expect(await consumersOf(root, backend, "PORT")).toEqual(["app:api", "root"]);

  await runUnwire(root, "PORT", ["app:api"], { backend, stamp: "s2" });
  expect(await consumersOf(root, backend, "PORT")).toEqual(["root"]);
});

test("wiring to root materializes a repo-root .env", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" } } });
  await runWire(root, "PORT", ["root"], { backend, stamp: "s" });
  expect(await Bun.file(`${root}/.env`).text()).toContain("PORT=3000");
});

test("wiring to an app that had no .env at init materializes its .env", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" }, web: undefined } });
  await runWire(root, "PORT", ["web"], { backend, stamp: "s" });
  expect(await Bun.file(`${root}/apps/web/.env`).text()).toContain("PORT=3000");
});

test("rm deletes a variable and its value", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" } } });
  await runRm(root, "PORT", { backend, stamp: "s" });
  const { model } = await loadModel(root, { backend });
  expect(model.variables.find((v) => v.name === "PORT")).toBeUndefined();
  expect(runGet(root, "PORT", { backend })).rejects.toThrow(/no variable named/);
});
