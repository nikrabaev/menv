import { MenvError } from "../core/errors.ts";
import { planSetValue, resolveMappingKey } from "../core/ops/value.ts";
import type { Registry } from "../registry/types.ts";
import type { Io } from "./output.ts";
import { emitResult } from "./output.ts";
import type { ReadValueDeps } from "./prompt.ts";
import { readValue } from "./prompt.ts";
import type { MutationFlags, PromptFn } from "./run.ts";
import { openVaultSession, runMutation } from "./run.ts";

export interface SetArgs {
  name: string;
  vault?: string; // defaults to registry.defaults.vault
  consumer?: string;
  valueArg?: string; // omitted → stdin or masked prompt
}

export async function runSet(
  root: string,
  registry: Registry,
  args: SetArgs,
  flags: MutationFlags,
  io: Io,
  readDeps?: ReadValueDeps,
  promptFn?: PromptFn,
): Promise<void> {
  const vault = args.vault ?? registry.defaults.vault;
  const value = await readValue(args.valueArg, readDeps);
  const op = planSetValue(registry, { name: args.name, vault, consumer: args.consumer, value });
  await runMutation(root, registry, op, flags, io, new Map(), {}, promptFn);
}

export interface GetArgs {
  name: string;
  vault?: string;
  consumer?: string;
}

// Pretty mode prints the RAW value with no newline (secrets included — that is
// get's contract); json mode wraps it in the envelope.
export async function runGet(
  root: string,
  registry: Registry,
  args: GetArgs,
  flags: MutationFlags,
  io: Io,
  promptFn?: PromptFn,
): Promise<void> {
  const vault = args.vault ?? registry.defaults.vault;
  const { key } = resolveMappingKey(registry, { name: args.name, vault, consumer: args.consumer });
  const session = await openVaultSession(root, registry, vault, flags, promptFn);
  try {
    const value = await session.get(key);
    if (value === undefined) {
      throw new MenvError("NOT_FOUND", `no value stored for "${args.name}" in vault "${vault}"`);
    }
    if (flags.mode === "json") {
      emitResult(io, "json", { name: args.name, vault, value }, value);
    } else {
      io.stdout(value);
    }
  } finally {
    await session.close();
  }
}
