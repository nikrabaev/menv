# menv

A modern TUI for managing environment variables across a monorepo.

## Install (dev)

```bash
bun install
bun link
```

This exposes `menv` on your PATH.

Or build a standalone binary:

```bash
bun run build
```

This produces `./menv`.

## Usage

```bash
menv init
menv
menv generate
```

`menv init` scans the repo, sets up the encrypted vault, and updates
`.gitignore`.

`menv` launches the TUI.

`menv generate` regenerates all `.env` files from the vault for CI-friendly
headless use.

Values are stored age-encrypted under `.menv/values/`. Structure lives in
`menv.toml` and `.menv/manifest.toml`. Generated `.env` files are git-ignored.
`.env.example` files are regenerated as committed, values-free templates.
