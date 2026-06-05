import { expect, test } from "bun:test";
import { runAutoGroup } from "../../src/cli/autoGroup.ts";
import { loadModel } from "../../src/cli/context.ts";
import { runDefine } from "../../src/cli/define.ts";
import { scaffold } from "./helpers.ts";

const groupOf = (model: { variables: { name: string; group: string | null }[] }, name: string) =>
  model.variables.find((v) => v.name === name)!.group;

test("auto-group assigns variables to groups by shared prefix", async () => {
  const { root, backend } = await scaffold({
    apps: { api: { DB_USER: "u", DB_PASSWORD: "p", DB_HOST: "h", PORT: "3000" } },
  });

  const result = await runAutoGroup(root, { backend, stamp: "s" });
  expect(result.grouped).toBe(3);
  expect(result.groups).toEqual(["DB"]);

  const { model } = await loadModel(root, { backend });
  expect(groupOf(model, "DB_USER")).toBe("DB");
  expect(groupOf(model, "DB_PASSWORD")).toBe("DB");
  expect(groupOf(model, "DB_HOST")).toBe("DB");
  // PORT has no prefix (no underscore) ⇒ left ungrouped.
  expect(groupOf(model, "PORT")).toBeNull();
});

test("auto-group preserves a manually-set group by default", async () => {
  const { root, backend } = await scaffold({
    apps: { api: { DB_USER: "u", DB_PASSWORD: "p", DB_HOST: "h" } },
  });
  await runDefine(root, "DB_USER", { backend, group: "Custom", stamp: "s1" });

  await runAutoGroup(root, { backend, stamp: "s2" });

  const { model } = await loadModel(root, { backend });
  // The manually grouped var is untouched; the two ungrouped siblings get "DB".
  expect(groupOf(model, "DB_USER")).toBe("Custom");
  expect(groupOf(model, "DB_PASSWORD")).toBe("DB");
  expect(groupOf(model, "DB_HOST")).toBe("DB");
});

test("auto-group --force re-derives groups for every variable", async () => {
  const { root, backend } = await scaffold({
    apps: { api: { DB_USER: "u", DB_PASSWORD: "p", DB_HOST: "h" } },
  });
  await runDefine(root, "DB_USER", { backend, group: "Custom", stamp: "s1" });

  const result = await runAutoGroup(root, { backend, overwrite: true, stamp: "s2" });
  expect(result.grouped).toBe(3);

  const { model } = await loadModel(root, { backend });
  expect(groupOf(model, "DB_USER")).toBe("DB");
});

test("auto-group is a no-op when nothing shares a prefix", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000", HOST: "localhost" } } });

  const result = await runAutoGroup(root, { backend, stamp: "s" });
  expect(result.grouped).toBe(0);
  expect(result.groups).toEqual([]);

  const { model } = await loadModel(root, { backend });
  expect(groupOf(model, "PORT")).toBeNull();
  expect(groupOf(model, "HOST")).toBeNull();
});
