import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoModel } from "../../src/core/types.ts";
import { discoverComposeFiles, writeComposeFiles } from "../../src/io/compose.ts";
import { writeGeneratedFiles } from "../../src/io/generate.ts";

test("discoverComposeFiles finds conventional names and ignores node_modules/.git/.menv", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "infra"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, ".menv"), { recursive: true });
  await Bun.write(join(root, "docker-compose.yml"), "services: {}\n");
  await Bun.write(join(root, "docker-compose.prod.yaml"), "services: {}\n");
  await Bun.write(join(root, "infra", "compose.yml"), "services: {}\n");
  await Bun.write(join(root, "node_modules", "pkg", "docker-compose.yml"), "services: {}\n");
  await Bun.write(join(root, ".menv", "compose.yml"), "services: {}\n");

  const found = await discoverComposeFiles(root);
  expect(found).toEqual(["docker-compose.prod.yaml", "docker-compose.yml", "infra/compose.yml"]);
});

const apiModel = (root: string): RepoModel => ({
  root,
  environments: [{ id: "dev", isDefault: true }],
  variables: [
    { id: "v1", name: "DATABASE_URL", description: "", group: null, secret: true, wiring: [{ consumer: "app:api" }] },
  ],
  consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
  values: { v1: { dev: "pg://x" } },
  recipients: [],
});

test("writeComposeFiles fills the region and writes .env.compose beside the file", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const compose = [
    "services:",
    "  api:",
    "    environment:",
    "      # <menv:api>",
    "      # </menv>",
  ].join("\n");
  await Bun.write(join(root, "docker-compose.yml"), `${compose}\n`);

  const written = await writeComposeFiles(apiModel(root), "dev", "ts1");
  expect(written).toContain("docker-compose.yml");
  expect(written).toContain(".env.compose");

  const out = await Bun.file(join(root, "docker-compose.yml")).text();
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docker-compose interpolation fixture
  expect(out).toContain("      - DATABASE_URL=${API_DATABASE_URL}");
  expect(await Bun.file(join(root, ".env.compose")).text()).toBe("API_DATABASE_URL=pg://x\n");
});

test("writeComposeFiles leaves a marker-free compose file untouched and writes no .env.compose", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const compose = "services:\n  api:\n    environment:\n      - NODE_ENV=production\n";
  await Bun.write(join(root, "docker-compose.yml"), compose);

  const written = await writeComposeFiles(apiModel(root), "dev", "ts1");
  expect(written).toEqual([]);
  expect(await Bun.file(join(root, "docker-compose.yml")).text()).toBe(compose);
  expect(existsSync(join(root, ".env.compose"))).toBe(false);
});

test("writeComposeFiles unions refs from two files in the same directory into one .env.compose", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }],
    variables: [
      { id: "v1", name: "DATABASE_URL", description: "", group: null, secret: true, wiring: [{ consumer: "app:api" }] },
      { id: "v2", name: "QUEUE_URL", description: "", group: null, secret: true, wiring: [{ consumer: "app:worker" }] },
    ],
    consumers: [
      { kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" },
      { kind: "app", id: "app:worker", name: "worker", path: "apps/worker", envFile: ".env" },
    ],
    values: { v1: { dev: "pg://x" }, v2: { dev: "amqp://q" } },
    recipients: [],
  };

  const base = [
    "services:",
    "  api:",
    "    environment:",
    "      # <menv:api>",
    "      # </menv>",
  ].join("\n");
  const override = [
    "services:",
    "  worker:",
    "    environment:",
    "      # <menv:worker>",
    "      # </menv>",
  ].join("\n");

  await Bun.write(join(root, "docker-compose.yml"), `${base}\n`);
  await Bun.write(join(root, "docker-compose.override.yml"), `${override}\n`);

  const written = await writeComposeFiles(model, "dev", "ts2");
  // Both compose files and exactly one .env.compose
  expect(written).toContain("docker-compose.yml");
  expect(written).toContain("docker-compose.override.yml");
  expect(written.filter((p) => p === ".env.compose")).toHaveLength(1);

  const envCompose = await Bun.file(join(root, ".env.compose")).text();
  // Union of both consumers' prefixed vars
  expect(envCompose).toContain("API_DATABASE_URL=pg://x");
  expect(envCompose).toContain("WORKER_QUEUE_URL=amqp://q");
});

test("writeGeneratedFiles fills compose regions and flips .env.compose by env", async () => {
  const root = mkdtempSync(join(tmpdir(), "menv-"));
  await mkdir(join(root, "apps", "api"), { recursive: true });
  const compose = "services:\n  api:\n    environment:\n      # <menv:api>\n      # </menv>\n";
  await Bun.write(join(root, "docker-compose.yml"), compose);
  const model: RepoModel = {
    root,
    environments: [{ id: "dev", isDefault: true }, { id: "prod", isDefault: false }],
    variables: [{ id: "v1", name: "PORT", description: "", group: null, secret: false, wiring: [{ consumer: "app:api" }] }],
    consumers: [{ kind: "app", id: "app:api", name: "api", path: "apps/api", envFile: ".env" }],
    values: { v1: { dev: "3000", prod: "8080" } },
    recipients: [],
  };

  const written = await writeGeneratedFiles(model, "dev", "ts1");
  expect(written).toContain("docker-compose.yml");
  expect(written).toContain(".env.compose");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal docker-compose interpolation fixture
  expect(await Bun.file(join(root, "docker-compose.yml")).text()).toContain("      - PORT=${API_PORT}");
  expect(await Bun.file(join(root, ".env.compose")).text()).toBe("API_PORT=3000\n");

  await writeGeneratedFiles(model, "prod", "ts2");
  expect(await Bun.file(join(root, ".env.compose")).text()).toBe("API_PORT=8080\n");
});
