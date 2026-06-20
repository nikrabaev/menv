import { join } from "node:path";
import { MenvError } from "../core/errors.ts";
import { writeFileAtomic } from "../io/write.ts";
import type { Registry } from "./types.ts";
import { validateRegistry } from "./validate.ts";

export const REGISTRY_FILENAME = "menv.json";

export async function loadRegistry(root: string): Promise<Registry> {
  const file = Bun.file(join(root, REGISTRY_FILENAME));
  if (!(await file.exists())) {
    throw new MenvError("NOT_FOUND", `no ${REGISTRY_FILENAME} found in ${root} — run \`menv init\` first`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    throw new MenvError("PARSE", `${REGISTRY_FILENAME} is not valid JSON: ${(e as Error).message}`);
  }
  const { registry, issues } = validateRegistry(parsed);
  if (registry === null) {
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new MenvError("VALIDATION", `${REGISTRY_FILENAME} is invalid — ${summary}`, issues);
  }
  return registry;
}

// Canonical on-disk form: 2-space indent + trailing newline, so diffs stay
// minimal and generated edits are byte-stable.
export async function saveRegistry(root: string, registry: Registry): Promise<void> {
  await writeFileAtomic(root, REGISTRY_FILENAME, `${JSON.stringify(registry, null, 2)}\n`);
}
