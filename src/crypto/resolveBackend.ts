import type { KeyBackendConfig } from "../core/types.ts";
import {
  envPassphraseProvider,
  type KeyBackend,
  keychainBackend,
  onePasswordBackend,
  type PassphraseProvider,
  passwordBackend,
} from "./identity.ts";

export interface BackendContext {
  root: string;
  // True for the init/TUI paths (a passphrase prompt is safe); false for the
  // headless `generate` path (passphrase comes from MENV_PASSPHRASE).
  interactive: boolean;
  // Interactive passphrase provider, supplied by the CLI/UI layer so that
  // src/crypto never imports Ink. Falls back to the env provider when absent.
  pass?: PassphraseProvider;
  // 1Password item placement for a freshly created identity.
  vault?: string;
  title?: string;
}

// Turns the persisted backend config into a concrete KeyBackend for the current
// command. The chosen kind comes from menv.toml (or, at init, the flag/menu).
export function resolveBackend(cfg: KeyBackendConfig, ctx: BackendContext): KeyBackend {
  switch (cfg.kind) {
    case "keychain":
      if (process.platform !== "darwin") {
        throw new Error(
          "This repo's menv vault uses the macOS Keychain backend, which is unavailable on this platform. " +
            "Re-run `menv init --backend password` (or `--backend 1password`) on a checkout to switch.",
        );
      }
      return keychainBackend;
    case "password":
      return passwordBackend({ root: ctx.root, pass: ctx.pass ?? envPassphraseProvider() });
    case "1password":
      return onePasswordBackend({ ref: cfg.opRef, vault: ctx.vault, title: ctx.title });
  }
}
