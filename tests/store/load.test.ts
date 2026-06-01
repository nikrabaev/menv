import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveModel } from "../../src/store/save.ts";
import { loadRepo } from "../../src/store/load.ts";
import { generateKeypair } from "../../src/crypto/age.ts";
import type { RepoModel } from "../../src/core/types.ts";

test("loadRepo reconstructs the model including decrypted values", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const { identity, recipient } = await generateKeypair();
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [{ id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:api"] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: { "var:PORT": { dev: "3000" } },
    recipients: [recipient],
  };
  await saveModel(model, "dev", "s1");

  const loaded = await loadRepo(root, identity);
  expect(loaded.values["var:PORT"].dev).toBe("3000");
  expect(loaded.variables[0].name).toBe("PORT");
});
