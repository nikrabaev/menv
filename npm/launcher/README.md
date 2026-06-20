# menv

Keyboard-friendly **CLI + TUI** for managing environment variables across a
monorepo. The *structure* (which variables exist, who consumes them, how they map
into vault keys) lives in one committed registry (`menv.json`); the *values* live
in pluggable, **age-encrypted** vaults; plaintext `.env` files are **generated
outputs**, never the source of truth.

## Install

```bash
npm install -g @nikrabaev/menv
# or: pnpm add -g @nikrabaev/menv  •  bun add -g @nikrabaev/menv
```

This installs a self-contained `menv` binary for your platform (macOS, Linux, or
Windows on x64/arm64). **No Bun or Node runtime is needed to run it** — the
package ships prebuilt executables and a thin launcher that picks the right one.

Other ways to install (Homebrew, direct binary download) and the full command
reference live in the [project README](https://github.com/nikrabaev/menv#readme).

## Quick start

```bash
menv init                # create menv.json + an encrypted local vault
menv var define DATABASE_URL --secret
menv wire DATABASE_URL --consumers api
printf '%s' 'postgres://localhost/app' | menv set DATABASE_URL
menv generate            # write the .env outputs from the vault
menv                     # launch the TUI
```

## Links

- Source, docs, and issues: <https://github.com/nikrabaev/menv>
- License: MIT
