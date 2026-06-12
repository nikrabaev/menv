import { join } from "node:path";
import { MenvError } from "../core/errors.ts";
import type { VaultAuth } from "./provider.ts";

export const AUTH_FILE_REL = ".menv/auth.local.json";

// Per-machine auth hooks (spec: "Auth resolution"). Three source types cover
// every secret manager — `op read`, Keychain lookups, … are just commands.
type AuthFileEntry =
  | { type: "value"; value: string }
  | { type: "env"; name: string }
  | { type: "command"; command: string };

export interface ResolveAuthOptions {
  root: string;
  // From --vault-auth <vault>=<secret>, already split by the CLI.
  flag?: string;
  // Injectable for tests; callers pass process.env.
  env: Record<string, string | undefined>;
  // Provided only when stdin is a TTY (the CLI decides). Resolution NEVER
  // prompts on its own — that's the non-interactive promise.
  promptFn?: (vaultName: string) => Promise<string>;
}

export function authEnvVarName(vault: string): string {
  return `MENV_VAULT_AUTH_${vault.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

async function readAuthFileEntry(root: string, vault: string): Promise<AuthFileEntry | undefined> {
  const file = Bun.file(join(root, AUTH_FILE_REL));
  if (!(await file.exists())) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new MenvError("PARSE", `${AUTH_FILE_REL} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new MenvError("PARSE", `${AUTH_FILE_REL} must contain a JSON object`);
  }
  const entry = (parsed as Record<string, unknown>)[vault];
  if (entry === undefined) return undefined;
  const e = entry as Record<string, unknown>;
  if (e.type === "value" && typeof e.value === "string") return { type: "value", value: e.value };
  if (e.type === "env" && typeof e.name === "string") return { type: "env", name: e.name };
  if (e.type === "command" && typeof e.command === "string") return { type: "command", command: e.command };
  throw new MenvError("PARSE", `${AUTH_FILE_REL}: entry for "${vault}" must be {type: value|env|command, …}`);
}

async function runAuthCommand(vault: string, command: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    throw new MenvError("AUTH_FAILED", `auth command for vault "${vault}" failed: ${stderr.trim() || command}`);
  }
  return stdout.trim();
}

// flag → env → auth file → prompt (TTY-only, injected) → hard error.
export async function resolveVaultAuth(vault: string, opts: ResolveAuthOptions): Promise<VaultAuth> {
  if (opts.flag !== undefined) return { secret: opts.flag };

  const envVar = authEnvVarName(vault);
  const fromEnv = opts.env[envVar];
  if (fromEnv !== undefined) return { secret: fromEnv };

  const entry = await readAuthFileEntry(opts.root, vault);
  if (entry !== undefined) {
    if (entry.type === "value") return { secret: entry.value };
    if (entry.type === "env") {
      const v = opts.env[entry.name];
      if (v === undefined) {
        throw new MenvError("AUTH_FAILED", `${AUTH_FILE_REL}: "${vault}" points at unset env var ${entry.name}`);
      }
      return { secret: v };
    }
    return { secret: await runAuthCommand(vault, entry.command) };
  }

  if (opts.promptFn !== undefined) return { secret: await opts.promptFn(vault) };

  throw new MenvError(
    "AUTH_MISSING",
    `no auth for vault "${vault}". Supply it via --vault-auth ${vault}=…, ` +
      `the ${envVar} env var, a "${vault}" entry in ${AUTH_FILE_REL}, or run on a TTY to be prompted.`,
  );
}
