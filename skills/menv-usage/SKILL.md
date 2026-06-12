---
name: menv-usage
description: >-
  Use when working in a repo managed by menv — environment variables and secrets
  live in an age-encrypted vault (a menv.toml + .menv/ at the root) and the .env
  files are GENERATED, not authored. Trigger whenever a task touches env vars,
  secrets, API keys, database URLs, or .env / .env.<env> / .env.example files in
  such a repo: adding or changing a variable, wiring one to an app, reading a
  value, setting a per-environment or local value, or "my .env is empty / out of
  date". ESPECIALLY before editing any .env by hand — in a menv repo that edit is
  the wrong move and gets silently overwritten. If you see a menv.toml or a .menv/
  directory, this skill applies.
---

# Using menv

`menv` keeps every environment variable and secret for a repo in one
age-encrypted **vault** (committed as ciphertext) and **generates** the plaintext
`.env` files on demand. A repo uses it if there's a `menv.toml` and a `.menv/`
directory at the root. Run `menv --help` to confirm it's installed; if a bare
`menv` isn't found, check the project's `package.json` scripts / `./bin/` / README
for how it's invoked (e.g. `bun run menv`) and substitute that below.

## The one rule

**The vault is the source of truth. Every `.env`, `.env.<env>`, and `.env.local`
is a disposable, git-ignored *output*.** Change variables through the `menv` CLI;
the affected files regenerate for you.

Never hand-edit a generated `.env`, and never `git add` one. A hand edit isn't a
real change — the next `menv generate` (or any mutating command) rewrites that
file from the vault, so the edit silently vanishes. If a value is wrong, fix it
*in the vault* (`menv set`). If you find a value that exists only in a `.env`
(someone added it by hand), import it into the vault so it survives regeneration —
don't leave it in the file.

## Gotchas that bite (the part worth reading)

- **Keep secret values out of shell history and logs.** Pipe them on stdin
  (`printf '%s' "$V" | menv set NAME`) or omit the value and let `menv set`
  prompt. Never pass a secret as a literal CLI argument. `menv get` prints the
  *raw* value (secrets included) — don't `echo`/log it; `menv list` masks them.
- **Values are single-line.** A multi-line value (e.g. a PEM key) isn't supported
  — put it on one line with escaped `\n`, or keep it out of the vault. Pasting a
  raw multi-line blob risks a corrupted `.env`.
- **The `password` key backend needs `MENV_PASSPHRASE`** for any headless run
  (`MENV_PASSPHRASE=… menv generate`). The `keychain` / `1password` backends use
  the ambient credential and need nothing extra.
- **Ambiguous names need `--scope`.** If a name exists with more than one value,
  menv reports the conflict rather than guessing — re-run with a scope it names.
- **There is no separate "save".** Every mutating command (`define`, `set`,
  `wire`, `unwire`, `rm`) re-encrypts the vault and regenerates the affected
  files. Wiring a variable to an app that had no `.env` *materializes* one.

## Command cheatsheet

```bash
# read
menv list                       # overview (secrets ***, unset empty, locals tagged)
menv list --scope web --json    # filter to one app + machine-readable records
menv get NAME [--env prod]       # RAW value to stdout — pipeable, don't log secrets

# change / add   (define = shape + wiring;  set = value)
menv set NAME [value] [--env prod]              # value via arg, stdin, or prompt
menv define NAME --secret --scope web,worker,root --description "…"
printf '%s' "$V" | menv set NAME                # a secret, via stdin

# wiring — which consumers receive it ("root" = the repo-root .env)
menv wire NAME api     ·     menv unwire NAME worker     ·     menv rm NAME

# regenerate (headless / CI) — password backend reads MENV_PASSPHRASE
menv generate [--env prod]

# environments & local overrides
menv set NAME … --env prod           # a per-environment value (vault only — the
                                     # generated .env keeps the default env;
                                     # switch with `menv generate --env prod`)
menv <define|set|get|rm> NAME --local  # the .env.local override: a SEPARATE variable,
                                       # generated into .local, kept out of .env.example
menv mode <app> single|perenv        # one .env  vs  one .env.<env> per environment
```

When unsure what exists or how something is wired, `menv list --json` shows the
full picture before you mutate anything.
