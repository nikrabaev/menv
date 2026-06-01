import { expect, test } from "bun:test";
import { scaffold } from "./helpers.ts";
import { runDefine } from "../../src/cli/define.ts";
import { runSet } from "../../src/cli/set.ts";
import { runList } from "../../src/cli/list.ts";

test("list shows variables and masks secret values", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" } } });
  await runDefine(root, "TOKEN", { backend, secret: true, scope: ["api"], stamp: "s1" });
  await runSet(root, "TOKEN", { backend, value: "supersecret", stamp: "s2" });

  const out = await runList(root, { backend });
  expect(out).toContain("PORT");
  expect(out).toContain("3000");
  expect(out).toContain("TOKEN");
  expect(out).toContain("***");
  expect(out).not.toContain("supersecret");
});

test("list --json includes raw values and metadata", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" } } });
  const arr = JSON.parse(await runList(root, { backend, json: true }));
  const port = arr.find((x: { name: string }) => x.name === "PORT");
  expect(port.value).toBe("3000");
  expect(port.consumers).toEqual(["app:api"]);
});

test("list --scope filters to one consumer", async () => {
  const { root, backend } = await scaffold({ apps: { api: { PORT: "3000" }, web: { WEB_VAR: "x" } } });
  const arr = JSON.parse(await runList(root, { backend, scope: "web", json: true }));
  expect(arr.map((x: { name: string }) => x.name)).toEqual(["WEB_VAR"]);
});

test("list marks an unset value as empty", async () => {
  const { root, backend } = await scaffold();
  await runDefine(root, "BLANK", { backend, scope: ["api"], stamp: "s" });
  const out = await runList(root, { backend });
  expect(out.split("\n").find((l) => l.includes("BLANK"))).toContain("empty");
});
