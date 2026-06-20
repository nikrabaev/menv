---
name: menv-usage
description: >-
  Use when working in a repo managed by menv — the structure of environment
  variables lives in a committed registry (menv.json at the root) and the VALUES
  live in pluggable vaults; the .env files are GENERATED, not authored. Trigger
  whenever a task touches env vars, secrets, API keys, database URLs, or
  .env / .env.example / .env.compose files in such a repo: adding or changing a
  variable, wiring one to a consumer, reading or setting a value, or "my .env is
  empty / out of date". ESPECIALLY before editing any .env by hand — in a menv
  repo that edit is the wrong move and gets silently overwritten by
  `menv generate`. If you see a menv.json or a .menv/ directory, this skill
  applies.
---

# Using menv

`menv` keeps the *structure* of a repo's environment in one committed
**registry** (`menv.json`) and the *values* in pluggable **vaults** (the bundled
`menv-local` vault age-encrypts them). It **generates** the plaintext `.env`
files on demand. A repo uses it if there's a `menv.json` at the root. Run
`menv --help` to confirm it's installed; if a bare `menv` isn't found, check the
project's `package.json` scripts / README for how it's invoked (e.g.
`bun run menv`) and substitute that below.

## The one rule

**The registry is the source of truth for structure; values live in vaults —
never in the registry, and never in a `.env`.** Every `.env`, `.env.example`, and
`.env.compose` is a generated *output*.

Never hand-edit a generated `.env`, and never `git add` one. A hand edit isn't a
real change — the next `menv generate` rewrites that file from the vault, so the
edit silently vanishes. Change *structure* through registry commands and *values*
through `menv set`, then run `menv generate`. `menv check` flags any drift between
the registry/vault and the files on disk.

## Gotchas that bite (the part worth reading)

- **Keep secret values out of shell history and logs.** Pipe them on stdin
  (`printf '%s' "$V" | menv set NAME`) or omit the value and let `menv set`
  prompt. Never pass a secret as a literal CLI argument. `menv get` prints the
  *raw* value (secrets included) — don't `echo`/log it; `var list` / `var show`
  and any `--output json` plan mask them.
- **Prefer machine-readable output and previews.** Use `--output json` for results
  you parse, and `--dry-run` to preview *any* mutation before applying it.
- **Run `menv check` after a batch of changes.** `menv check --output json`; exit
  **1** means problems (broken interpolation refs, stale generated files, a
  plaintext vault or `.env` tracked by git).
- **Vault auth must be non-interactive in scripts.** Supply it via
  `MENV_VAULT_AUTH_<VAULT>` (upper-cased vault name) or a `.menv/auth.local.json`
  entry. Off a TTY, menv never prompts — a missing key is a hard error (exit 3).
- **Values are single-line.** A multi-line value (e.g. a PEM key) isn't supported
  — put it on one line with escaped `\n`, or keep it out of the vault.
- **Mutations never write outputs.** `set`, `wire`, `var define`, … only touch the
  registry/vault. `menv generate` is the only writer of `.env` files.

## Command cheatsheet

```bash
# read (structure + masked values)
menv var list [--vault V] [--consumer C] [--output json]   # variables, secrets masked
menv var show NAME                                         # one variable, secrets masked
menv get NAME [--vault V]                                  # RAW value to stdout — don't log secrets

# change structure (registry)
menv var define NAME --secret --description "…"            # define a variable
menv wire NAME --vault V --consumers api,worker            # new per-consumer key each; --shared/--key K to share one value
menv unwire NAME --vault V --consumers worker              # remove that mapping

# change values (vault)
menv set NAME [value] [--vault V] [--consumer C]          # value via arg, stdin, or masked prompt
printf '%s' "$V" | menv set NAME                          # a secret, via stdin

# generate + validate (the only writer of outputs; the CI gate)
menv generate [--vault V] [--consumer C]                  # rewrite .env / .env.example / .env.compose
menv check --output json || exit 1                        # exit 1 ⇒ problems
```

Every mutating command takes the global `--dry-run`, `--output pretty|json`,
`--force`, and `--vault-auth <vault>=<secret>` flags. When unsure what exists or
how something is wired, `menv var list --output json` shows the picture before you
mutate anything.
