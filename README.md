# menv

A keyboard-friendly **CLI** for managing environment variables across a monorepo.

menv keeps the *structure* of your environment — which variables exist, who
consumes them, how they map into vault keys — in one committed **registry**
(`menv.json`). The **values** live in pluggable **vaults** (the bundled
`menv-local` vault age-encrypts them into a committable file). Plaintext `.env`
files are never the source of truth: they are **generated outputs**, rewritten by
`menv generate` and git-ignored.

The mental model: edit *structure* in the registry and *values* in a vault via the
CLI. Never hand-edit a generated `.env` — it is an output. menv flags any drift
with `menv check`.

> The interactive TUI from v1 is not part of v2.0; it returns in a later release.
> Everything below is the CLI.

## Quick start

```bash
bun install              # install deps
bun link                 # (optional) put `menv` on your PATH; equals `bun run menv`

menv init                # create menv.json + an encrypted local vault
# menv init --no-encrypt   # plaintext local vault instead (stays git-ignored)

# Describe a recipient of generated files and a place to store values:
menv consumer add api --strategy single --base-dir apps/api
# (init already created the default `menv-local` vault)

# Define a variable, wire it to a consumer's vault key, give it a value:
menv var define DATABASE_URL --secret
menv wire DATABASE_URL --consumers api
printf '%s' 'postgres://localhost/app' | menv set DATABASE_URL

# Write the outputs:
menv generate            # apps/api/.env is created from the vault
menv check               # validate everything (CI gate)
```

`menv init` writes the registry and the local vault config but does **not** scan
your repo — you describe consumers and variables explicitly.

## Concepts

- **Registry** — `menv.json` (`schemaVersion` 2), committed. The single source of
  truth for *structure*: vaults, consumers, groups, globals, bound compose files,
  and every variable's `vaultMapping`. It never contains a value.
- **Vault** — a named, pluggable key/value store that *is* a generation context.
  The bundled `menv-local` provider keeps values in `.menv/vault.json` and
  optionally age-encrypts them (`encryption: true` ⇒ committable ciphertext;
  `false` ⇒ plaintext, which must stay git-ignored). HashiCorp Vault and AWS SSM
  are on the roadmap, not shipped.
- **Consumer** — an explicit recipient of generated files: a `baseDir` plus a file
  strategy (`single` = one `.env`; `per-vault` = one file per vault), optional
  `secretsAsLocalOverrides` (secret variables go to a `<file>.local` companion),
  and an optional committed `.env.example`.
- **Variable** — a globally unique name with a `vaultMapping[vault][consumer] →
  { key, disabled? }`. Two consumers pointing at the **same key** share one value;
  `disabled` emits the line commented-out. Variables may be marked `--secret`.
- **Group** — a label only, for organizing variables in listings.
- **Global** — a per-vault name that is either `runtime` (the platform provides it
  at run/deploy time — passed through) or `static` (menv substitutes a fixed
  `--value` at generate time).
- **Interpolation** — values and globals may reference `${NAME}`; write `$${` for a
  literal `${`. Variables and `static` globals expand at generate time; `runtime`
  globals pass through unexpanded. Reference cycles or unresolved names abort the
  generate.

## CLI reference

Run `menv <command> --help` for the authoritative flags. Global options apply to
every command:

| Global flag | Effect |
| --- | --- |
| `-o, --output <mode>` | `pretty` (default) or `json` — `MENV_OUTPUT` sets the default |
| `--dry-run` | compute and print the plan without applying it |
| `--force` | override blockers (dependent references, unverified vaults, …) |
| `--vault-auth <vault>=<secret>` | supply a vault's auth secret (repeatable) |

### Setup

| Command | Purpose |
| --- | --- |
| `init [--encrypt \| --no-encrypt]` | create `menv.json` and the local vault config (no scanning) |
| `generate [--vault <v>] [--consumer <c>]` | regenerate `.env` files (and compose) — the only writer of outputs |
| `check` | validate interpolation, vault keys, compose markers, staleness, git tracking |
| `completions <zsh\|bash>` | print a shell completion script |

### Management

Each manages an entity group; all sub-verbs accept the global flags.

- **`vault add|update|remove|list|show`** — `add <name> --type <vaultType>
  --config <k=v,…>`; `update <name> --config <k=v,…> --default`.
- **`consumer add|update|remove|list|show`** — `add <name> --strategy
  single|per-vault --base-dir <dir> --filename <file>` (or `--filenames
  <vault>=<file>,…` for `per-vault`), `--secrets-as-local-overrides`, `--example`,
  `--no-gitignore`; `remove <name> [--delete-files]`.
- **`group add|update|remove|list`** — `add <key> --title <text>`.
- **`global define|update|remove|list`** — `define <name> [--vault <v>] (--runtime
  | --value <value>) [--description <text>]`; `remove <name> [--vault <v>]`.
- **`compose bind|unbind|list`** — `bind <file>` registers a docker-compose file.

### Variables & values

| Command | Purpose |
| --- | --- |
| `var define <name> [--group <key>] [--secret] [--description <text>] [--example <text>]` | define a variable |
| `var update <name> [--group <key>] [--secret\|--no-secret] [--description] [--example]` | edit a definition |
| `var remove <name>` | delete a definition |
| `var list [--vault <v>] [--consumer <c>] [--group <key>]` | list variables (secrets masked) |
| `var show <name>` | inspect one variable (secrets masked) |
| `wire <name> --vault <v> --consumers <list> [--shared] [--key <key>]` | map a variable into a vault key for consumers |
| `unwire <name> --vault <v> --consumers <list>` | remove that mapping |
| `enable / disable <name> --vault <v> --consumer <c>` | uncomment / comment-out a wired line |
| `set <name> [value] [--vault <v>] [--consumer <c>]` | set a value (arg, stdin, or masked prompt) |
| `get <name> [--vault <v>] [--consumer <c>]` | print the raw value (pipeable) |
| `import <file> [--consumer <c>] [--vault <v>]` | ingest a dotenv file: define + wire + set |

### Backups

| Command | Purpose |
| --- | --- |
| `backup` | snapshot `menv.json`, the vault files, and generated files into `.menv/backups` |
| `restore [key]` | restore a backup (omit `key` to pick one on a TTY; `--force` skips the confirmation) |

## Values & secrets

`menv set NAME value` takes the value from the argument, but for secrets prefer
piping on stdin or omitting the argument:

```bash
printf '%s' "$SECRET" | menv set DATABASE_URL   # piped — stays out of shell history
menv set DATABASE_URL                           # no arg + TTY ⇒ masked prompt
```

`menv get NAME` prints the **raw** value (secrets included) to stdout, so it
pipes. Everywhere else — `var list`, `var show`, and any `--output json` plan —
secret values are masked. A real secret is never written into a plan.

## Generation & the ownership rule

`menv generate` is the **only** command that writes generated files; mutations
(`set`, `wire`, `var define`, …) never touch them. Every generated file carries a
disclaimer on its **first** line:

```text
# ── managed by menv ─ DO NOT EDIT ─────────────────────────…
# Generated from menv.json · vault: menv-local · consumer: api
# Re-create with `menv generate`; your edits will be overwritten.
```

menv only overwrites or deletes a file that still carries that marker. Remove the
marker to take a file over — menv then leaves it alone and `check` reports it.
`consumer remove` **releases** the consumer's files by stripping the marker by
default; pass `--delete-files` to delete them instead. A consumer created with
`--example` also emits a values-free, committed `.env.example`.

## Compose

Docker-compose files are user-owned; menv only fills a hand-authored region.
Register the file, then add markers around the block menv should manage:

```yaml
services:
  api:
    environment:
      # <menv:api>
      # </menv>
```

```bash
menv compose bind docker-compose.yml
menv generate                                   # fills the region; also writes .env.compose
docker compose --env-file .env.compose up
```

`menv generate` rewrites only the lines between `# <menv:consumer>` and `# </menv>`
and writes the interpolation values to `.env.compose` (git-ignored).

## Vaults, auth & encryption

A vault's auth secret (e.g. the `menv-local` passphrase) resolves in this order,
stopping at the first hit:

1. `--vault-auth <vault>=<secret>` on the command line
2. the `MENV_VAULT_AUTH_<VAULT>` environment variable (`<VAULT>` upper-cased, non
   `A–Z0–9` replaced with `_`)
3. a per-vault entry in `.menv/auth.local.json` (git-ignored, per machine)
4. a masked TTY prompt — **only** when stdin is a TTY

Off a TTY, a missing secret is a hard error (exit 3) — menv never blocks waiting
for input in CI. The auth file's entries take one of three hook shapes:

```jsonc
{
  "menv-local": { "type": "value",   "value": "the-passphrase" },
  "staging":    { "type": "env",     "name":  "STAGING_KEY" },
  "production": { "type": "command", "command": "op read op://vault/menv/password" }
}
```

Vaults are modular: the bundled `menv-local` provider is registered in
`src/vault/registry.ts`, and adding another provider is a registry entry
implementing the `VaultProvider` contract. Remote providers (HashiCorp, AWS SSM)
are on the roadmap.

## Headless / CI

menv is non-interactive off a TTY — it never prompts, and every command emits a
machine-readable `--output json` envelope (`{ ok, result }` / `{ ok, error }`).
Exit codes: **0** success (including `--dry-run`), **1** domain error / blockers /
`check` findings, **2** usage, **3** auth, **4** vault I/O.

```bash
export MENV_VAULT_AUTH_PRODUCTION="$DEPLOY_KEY"
menv check --output json || exit 1
menv generate --vault production --output json
```

## On-disk layout

`menv init` creates and the CLI manages:

```text
menv.json              # registry — committed
.menv/vault.json       # menv-local store — committed if encrypted, git-ignored if plaintext
.menv/auth.local.json  # per-machine vault auth — git-ignored, never committed
.menv/backups/         # `menv backup` snapshots — git-ignored
apps/*/.env            # GENERATED — git-ignored, never hand-edited
apps/*/.env.example    # GENERATED values-free template — committed (per-consumer opt-in)
.env.compose           # GENERATED compose interpolation values — git-ignored
```

menv maintains its own block in `.gitignore`, between marker lines, unioning
generated paths without touching your own entries:

```gitignore
# menv (managed block)
.env
apps/*/.env
.env.compose
# end menv
```

> **Note:** values are treated as single-line. A multi-line value (e.g. a PEM key
> spanning several lines) isn't supported yet — keep such values on one line
> (escaped `\n`) or out of the vault.

## Development

Runtime is **Bun** (not Node); `.ts` runs directly, no build step for development.

```bash
bun install            # install deps
bun run menv           # run the CLI from source (src/index.ts)
bun test               # whole suite
bun test tests/cli/program.disk.test.ts   # a single file
bun run lint           # Biome: lint + import-sort (read-only)
bun run lint:fix       # Biome: apply safe fixes
bun run build          # compile a standalone ./menv binary
```

## Security model

Values live in vaults, addressed by the keys in each variable's `vaultMapping`;
the registry never holds a value. The `menv-local` vault optionally age-encrypts
its JSON — encrypted, it is safe to commit; plaintext, it must stay git-ignored
(`menv check` enforces both). The key resolves per vault as described above, and
never enters the repo. Plaintext `.env` files are disposable outputs, regenerated
on demand and git-ignored — treat the encrypted vault as the thing you commit.
