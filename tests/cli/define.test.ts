import { expect, test } from "bun:test";
import { scaffold } from "./helpers.ts";
import { runDefine } from "../../src/cli/define.ts";
import { loadModel } from "../../src/cli/context.ts";

test("define creates a variable with metadata and wiring", async () => {
  const { root, backend } = await scaffold();
  await runDefine(root, "API_KEY", { backend, secret: true, description: "the key", scope: ["api", "root"], stamp: "s" });

  const { model } = await loadModel(root, { backend });
  const v = model.variables.find((x) => x.name === "API_KEY")!;
  expect(v.secret).toBe(true);
  expect(v.description).toBe("the key");
  expect(v.consumers.sort()).toEqual(["app:api", "root"]);
});

test("define updates an existing variable's metadata in place", async () => {
  const { root, backend } = await scaffold();
  await runDefine(root, "API_KEY", { backend, secret: true, stamp: "s1" });
  await runDefine(root, "API_KEY", { backend, secret: false, description: "updated", stamp: "s2" });

  const { model } = await loadModel(root, { backend });
  const named = model.variables.filter((x) => x.name === "API_KEY");
  expect(named.length).toBe(1);
  expect(named[0]!.secret).toBe(false);
  expect(named[0]!.description).toBe("updated");
});

test("define --scope replaces the consumer set", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" }, web: undefined } });
  await runDefine(root, "API_KEY", { backend, scope: ["api"], stamp: "s1" });
  await runDefine(root, "API_KEY", { backend, scope: ["web", "root"], stamp: "s2" });

  const { model } = await loadModel(root, { backend });
  expect(model.variables.find((x) => x.name === "API_KEY")!.consumers.sort()).toEqual(["app:web", "root"]);
});

test("define refuses to edit an ambiguous name", async () => {
  // Conflicting values across apps produce two variables of the same name at init.
  const { root, backend } = await scaffold({ apps: { api: { NODE_ENV: "development" }, web: { NODE_ENV: "production" } } });
  expect(runDefine(root, "NODE_ENV", { backend, secret: true, stamp: "s" })).rejects.toThrow(/ambiguous/);
});

test("define rejects an unknown scope", async () => {
  const { root, backend } = await scaffold();
  expect(runDefine(root, "API_KEY", { backend, scope: ["nope"], stamp: "s" })).rejects.toThrow(/unknown scope/);
});
