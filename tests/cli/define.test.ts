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

test("define --local creates a separate local-override variable", async () => {
  const { root, backend } = await scaffold();
  await runDefine(root, "API_URL", { backend, scope: ["api"], stamp: "s1" });
  await runDefine(root, "API_URL", { backend, local: true, scope: ["api"], stamp: "s2" });

  const { model } = await loadModel(root, { backend });
  const vars = model.variables.filter((v) => v.name === "API_URL");
  expect(vars.length).toBe(2);
  const base = vars.find((v) => !v.local)!;
  const local = vars.find((v) => v.local)!;
  expect(base.id).toBe("var:API_URL");
  expect(local.id).toBe("var:API_URL.local");
  expect(local.local).toBe(true);
});

test("define (no flag) updates the base in place even when a local sibling exists", async () => {
  const { root, backend } = await scaffold();
  await runDefine(root, "API_URL", { backend, scope: ["api"], stamp: "s1" });
  await runDefine(root, "API_URL", { backend, local: true, scope: ["api"], stamp: "s2" });
  // A flagless redefine targets the base sibling — no ambiguity error.
  await runDefine(root, "API_URL", { backend, description: "base only", stamp: "s3" });

  const { model } = await loadModel(root, { backend });
  expect(model.variables.find((v) => v.name === "API_URL" && !v.local)!.description).toBe("base only");
  expect(model.variables.find((v) => v.name === "API_URL" && v.local)!.description).toBe("");
});
