import { join } from "node:path";
import { MenvError } from "../core/errors.ts";
import type { ImportReport } from "../core/ops/importOps.ts";
import { planImportEntries } from "../core/ops/importOps.ts";
import { parseDotenv } from "../io/dotenv.ts";
import type { Registry } from "../registry/types.ts";
import type { Io } from "./output.ts";
import type { MutationFlags, PromptFn } from "./run.ts";
import { openVaultSession, runMutation } from "./run.ts";

export interface ImportArgs {
  file: string; // repo-relative dotenv file
  consumer: string;
  vault: string;
}

function formatReport(r: ImportReport): string {
  const lines = [
    `defined: ${r.defined.length ? r.defined.sort().join(", ") : "none"}`,
    `wired:   ${r.wired.length ? r.wired.sort().join(", ") : "none"}`,
    `updated: ${r.updated.length ? r.updated.sort().join(", ") : "none"}`,
  ];
  for (const s of r.skipped) lines.push(`skipped: ${s.key} (${s.reason})`);
  return lines.join("\n");
}

export async function runImport(
  root: string,
  registry: Registry,
  args: ImportArgs,
  flags: MutationFlags,
  io: Io,
  newKey: () => string = () => crypto.randomUUID(),
  promptFn?: PromptFn,
): Promise<void> {
  const file = Bun.file(join(root, args.file));
  if (!(await file.exists())) throw new MenvError("NOT_FOUND", `no such file: ${args.file}`);
  const entries = parseDotenv(await file.text());

  // The session is needed up front: conflict detection compares against the
  // currently stored values of already-wired keys.
  const session = await openVaultSession(root, registry, args.vault, flags, promptFn);
  const currentValues = new Map<string, string>();
  for (const { key: name } of entries) {
    const entry = registry.variables[name]?.vaultMapping[args.vault]?.[args.consumer];
    if (entry === undefined) continue;
    const v = await session.get(entry.key);
    if (v !== undefined) currentValues.set(entry.key, v);
  }
  const { result, report } = planImportEntries(registry, {
    entries,
    consumer: args.consumer,
    vault: args.vault,
    currentValues,
    force: flags.force,
    newKey,
  });
  await runMutation(root, registry, result, flags, io, new Map([[args.vault, session]]), {
    result: { report },
    pretty: formatReport(report),
  });
}
