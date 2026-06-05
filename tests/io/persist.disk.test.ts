import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoModel } from "../../src/core/types.ts";
import { readModelFiles, writeModelFiles } from "../../src/io/persist.ts";

test("writes and reads config + manifest files", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "v1", name: "FOO", description: "", group: null, secret: false, wiring: [] }],
    consumers: [],
    values: {},
    recipients: ["age1x"],
  };
  await writeModelFiles(model);
  const parts = await readModelFiles(root);
  expect(parts.variables[0].name).toBe("FOO");
  expect(parts.environments[0].id).toBe("dev");
});
