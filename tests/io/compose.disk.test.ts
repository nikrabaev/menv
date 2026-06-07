import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverComposeFiles } from "../../src/io/compose.ts";

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
