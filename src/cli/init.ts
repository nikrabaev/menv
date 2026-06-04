import { join } from "node:path";
import { DEFAULT_KEY_BACKEND, type KeyBackendConfig, type KeyBackendKind } from "../core/types.ts";
import { generateKeypair, recipientFromIdentity } from "../crypto/age.ts";
import type { KeyBackend, PassphraseProvider } from "../crypto/identity.ts";
import { resolveBackend } from "../crypto/resolveBackend.ts";
import { scanRepo } from "../io/discovery.ts";
import { saveModel } from "../store/save.ts";
import { SKILL_CONTENT, SKILL_REL_PATH } from "./skill.ts";

const GITIGNORE_BLOCK = [
  "# menv",
  ".menv/values/",
  ".menv/backups/",
  // Note: .menv/identity.age (the password backend's passphrase-encrypted key) is
  // intentionally NOT ignored — it is committed so the vault is portable.
  ".env",
  ".env.*",
  "!.env.example",
].join("\n");

async function ensureGitignore(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  if (existing.includes(".menv/values/")) return;
  await Bun.write(path, `${existing + (existing.endsWith("\n") || existing === "" ? "" : "\n") + GITIGNORE_BLOCK}\n`);
}

export interface InitOpts {
  // Explicit backend (tests). Bypasses kind/resolver; its config is recorded as-is.
  backend?: KeyBackend;
  // Chosen backend kind (from `--backend`); when absent, `promptKind` decides, or
  // it falls back to keychain (the headless default).
  kind?: KeyBackendKind;
  vault?: string; // 1Password vault for a freshly created item
  stamp?: string;
  // Injected by the CLI layer so this module never imports Ink.
  promptKind?: () => Promise<KeyBackendKind>;
  pass?: PassphraseProvider;
  // Scaffold the menv-usage agent skill into the consumer repo. Tri-state: `true`
  // writes it, `false` skips; when omitted, `promptSkill` (a TTY) decides, else skip.
  withSkill?: boolean;
  promptSkill?: () => Promise<boolean>;
}

export interface InitResult {
  // What init did with the menv-usage skill: wrote a fresh copy, found one already
  // present (left untouched), or wasn't asked to scaffold it.
  skill: "written" | "exists" | "skipped";
}

export async function runInit(root: string, opts: InitOpts = {}): Promise<InitResult> {
  const { model } = await scanRepo(root);

  let backend: KeyBackend;
  let chosen: KeyBackendConfig | undefined;
  if (opts.backend) {
    backend = opts.backend;
  } else {
    const kind = opts.kind ?? (opts.promptKind ? await opts.promptKind() : DEFAULT_KEY_BACKEND.kind);
    backend = resolveBackend({ kind }, { root, interactive: true, pass: opts.pass, vault: opts.vault });
    chosen = { kind };
  }

  // Obtain the identity, capturing the config that must be persisted. A backend
  // with an existing identity (re-init) keeps the chosen kind; a fresh one returns
  // its config from set() — notably the 1Password reference.
  let identity = await backend.get();
  let config: KeyBackendConfig;
  if (identity == null) {
    const kp = await generateKeypair();
    config = await backend.set(kp.identity);
    identity = kp.identity;
  } else {
    config = chosen ?? DEFAULT_KEY_BACKEND;
  }

  model.recipients = [await recipientFromIdentity(identity)];
  model.keyBackend = config;

  const env = model.environments.find((e) => e.isDefault)?.id ?? model.environments[0]?.id ?? "dev";
  await saveModel(model, env, opts.stamp ?? `init-${env}`);
  await ensureGitignore(root);

  return { skill: await scaffoldSkill(root, opts) };
}

// Optionally drop the menv-usage skill into the consumer repo. Never clobber an
// existing one — a consumer may have customized it. Bun.write creates the
// .claude/skills/menv-usage/ parents.
async function scaffoldSkill(root: string, opts: InitOpts): Promise<InitResult["skill"]> {
  const wants = opts.withSkill ?? (opts.promptSkill ? await opts.promptSkill() : false);
  if (!wants) return "skipped";
  const path = join(root, SKILL_REL_PATH);
  if (await Bun.file(path).exists()) return "exists";
  await Bun.write(path, SKILL_CONTENT);
  return "written";
}
