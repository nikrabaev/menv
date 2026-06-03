import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGeneratedFiles } from "../../src/io/generate.ts";
import { detectDrift } from "../../src/io/drift.ts";
import type { RepoModel } from "../../src/core/types.ts";

async function fixture(): Promise<RepoModel> {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "web"), { recursive: true });
  return {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "var:PORT", name: "PORT", description: "", group: null, secret: false, consumers: ["app:web"] },
      { id: "var:DATABASE_URL", name: "DATABASE_URL", description: "", group: null, secret: true, consumers: ["app:web"] },
      { id: "var:TOKEN.local", name: "TOKEN", description: "", group: null, secret: true, consumers: ["app:web"], local: true },
    ],
    consumers: [{ kind: "app", id: "app:web", name: "web", path: "apps/web", envFile: ".env" }],
    values: { "var:PORT": { dev: "3000" }, "var:DATABASE_URL": { dev: "pg://x" }, "var:TOKEN.local": { dev: "secret1" } },
    recipients: [],
  };
}

test("a freshly generated tree reports no drift", async () => {
  const model = await fixture();
  await writeGeneratedFiles(model, "dev", "ts1");
  expect(await detectDrift(model, "dev")).toEqual([]);
});

test("detects changed, added and removed keys in a hand-edited .env", async () => {
  const model = await fixture();
  await writeGeneratedFiles(model, "dev", "ts1");
  // Hand-edit: change PORT, add EXTRA, drop DATABASE_URL.
  await Bun.write(join(model.root, "apps", "web", ".env"), "PORT=4000\nEXTRA=hi\n");

  const drifts = await detectDrift(model, "dev");
  const base = drifts.find((d) => d.rel === join("apps", "web", ".env"))!;
  expect(base.changed).toEqual([{ name: "PORT", varId: "var:PORT", expected: "3000", actual: "4000" }]);
  expect(base.added).toEqual([{ name: "EXTRA", value: "hi", description: "" }]);
  expect(base.removed).toEqual([{ name: "DATABASE_URL", varId: "var:DATABASE_URL" }]);
  expect(base.local).toBe(false);
});

test("detects drift in a .env.local against the local slice", async () => {
  const model = await fixture();
  await writeGeneratedFiles(model, "dev", "ts1");
  await Bun.write(join(model.root, "apps", "web", ".env.local"), "TOKEN=secret2\n");

  const drifts = await detectDrift(model, "dev");
  const local = drifts.find((d) => d.local)!;
  expect(local.rel).toBe(join("apps", "web", ".env.local"));
  expect(local.changed).toEqual([{ name: "TOKEN", varId: "var:TOKEN.local", expected: "secret1", actual: "secret2" }]);
});
