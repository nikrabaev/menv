# menv v2 — design spec

**Date:** 2026-06-12
**Status:** Design, approved by the menv author — pending implementation plan
**Author:** brainstormed with the menv author
**Supersedes:** the v1 model described in `2026-05-30-menv-design.md` and its follow-ups. The CLI framework choice from `2026-06-11-cli-framework-design.md` (commander v15 + extra-typings, hand-emitted completions) carries over; the grammar it froze does not.

## Why v2

v1 works, but its vision was incomplete. The recurring theme in what's wrong is
**implicitness**: `init` scans and invents structure, every mutation silently
regenerates files and silently snapshots backups, wiring state is inferred from
what happens to be on disk, duplicate variable names are "resolved" with a
`--scope` hack, and the only value store is one age-encrypted file format. v2
re-founds the tool on explicitness, with humans, AI agents, and CI scripts as
equal first-class users — **nothing may assume an interactive terminal**.

There are no existing menv users. v2 is a clean break: **no migration path, no
v1 compatibility**. `menv init` on a repo containing v1 files (`menv.toml`,
`.menv/manifest.toml`) refuses to proceed until they are deleted, so the two
generations can't half-coexist.

## Decision log

| # | Requirement | Decision |
|---|-------------|----------|
| 1 | Config in JSON | One committed registry file, `menv.json` (`schemaVersion: 2`). TOML is gone. |
| 2 | Explicit names/paths | Consumers declare `baseDir` + filenames in config. No filesystem discovery, ever. |
| 3 | No automatic backups | The before-write snapshots in v1's `atomicWrite` are removed. `menv backup` / `menv restore` are the only backup operations. |
| 4 | Consumer/environment management | Full noun-verb CLI: `menv vault|consumer|group|global … add/update/remove/list/show`. **Vault = environment** (one axis; see Concepts). |
| 5 | Disclaimer in generated files | Every generated file opens with a managed-by-menv header. `menv consumer remove` strips the header by default (releases ownership, files stay); `--delete-files` deletes them. |
| 6 | Explicit variable lifecycle | `menv var define/update/remove` only. `init` creates an *empty* registry; `menv import` is the explicit ingestion path. Mutations never regenerate files. |
| 7 | Unique names, grouped values | Variable names are globally unique. Values live in vaults; a variable's `vaultMapping` maps (vault × consumer) → vault key. Same key = shared value. `groups` are organizational labels only. |
| 8 | Globals | First-class `globals` section. Per vault, a global is `runtime` (platform-provided — Coolify et al.; references pass through to output) or `static` (menv substitutes the configured value). |
| 9 | Interpolation + dependency detection | `${NAME}` in values, expanded at generate time (hybrid model, below). Removal of a referenced variable/global is a blocker listing dependents, overridable with `--force`. |
| 10 | Dry-run everywhere | Every mutating command is internally **plan-then-execute**; `--dry-run` prints the plan and executes nothing. |
| 11 | Output modes | `--output pretty\|json` on every command (default `pretty`, `MENV_OUTPUT` overrides the default). Uniform JSON envelope. |
| 12 | Explicit compose binding | Registry lists compose files (`compose.files`); markers inside services are hand-authored by the user; menv only rewrites region contents and `.env.compose`. |
| 13 | Modular vaults | Public `VaultProvider` contract behind an internal registry keyed by `vaultType`. v2.0 ships **only `menv-local`** (JSON file, optional age encryption). Remote providers (HashiCorp Vault, AWS SSM) and npm-loaded plugins are roadmap. |
| + | Extra commands | `menv check` is in scope. `menv run`, `menv apply`, `menv diff` are roadmap candidates. |
| + | TUI | v2.0 is CLI-only. The TUI is rebuilt against the v2 core under its own future spec. |

## Concepts

| Concept | Definition |
|---------|------------|
| **Registry** | `menv.json` at the repo root, committed. The single source of structure: vaults, consumers, groups, globals, variables, compose files. Never contains a value. |
| **Vault** | A named KV store holding values — and simultaneously the *context* you generate for. "Generate for production" = "generate from the `production` vault". There is no separate environment entity; several vaults can even be the same provider type with different config. |
| **Consumer** | A named recipient of generated files with an explicit `baseDir` and a *file strategy* that decides which files it gets. |
| **Variable** | A globally unique name plus metadata (`groupKey`, `secret`, `description`, `example`) and a `vaultMapping`. |
| **Wiring** | The existence of a `vaultMapping[vault][consumer]` entry. Its `key` names where in that vault the value lives. Two consumers pointing at the same key share one value. |
| **Group** | A display label (`groupKey` → title). No storage or generation semantics beyond section headers in output. |
| **Global** | A name menv may interpolate but does not own (e.g. `COOLIFY_FQDN`). |

## Registry schema — `menv.json`

```jsonc
{
  "schemaVersion": 2,
  "defaults": { "vault": "local" },          // vault used when --vault is omitted

  "vaults": {
    "local": {
      "vaultType": "menv-local",
      "vaultConfig": {
        "filename": ".menv/vault.json",      // repo-relative
        "encryption": true                   // encrypted ⇒ committable; plaintext ⇒ must be git-ignored
      }
    },
    // A second vault for production values — also menv-local in v2.0, with its
    // own file and its own encryption key. Remote providers slot in here later
    // without schema changes: only vaultType/vaultConfig differ.
    "production": {
      "vaultType": "menv-local",
      "vaultConfig": { "filename": ".menv/vault.production.json", "encryption": true }
    }
  },

  "consumers": {
    "api": {
      "strategyType": "single",
      "strategyConfig": { "baseDir": "apps/api", "filename": ".env" }
    },
    "web": {
      "strategyType": "per-vault",
      "strategyConfig": {
        "baseDir": "apps/web",
        "secretsAsLocalOverrides": true,
        "example": true,                     // also emit a committed .env.example
        "filenames": {
          "local": ".env.development",
          "production": ".env.production"
        }
      }
    }
  },

  "groups": {
    "db": { "title": "Database" }
  },

  "globals": {
    "COOLIFY_FQDN": {
      "description": "Set by Coolify on deploy",
      "values": {
        "production": { "source": "runtime" },
        "local":      { "source": "static", "value": "localhost:3000" }
      }
    }
  },

  "variables": {
    "DATABASE_URL": {
      "groupKey": "db",
      "secret": true,
      "description": "Primary Postgres connection string",
      "example": "postgres://user:pass@host:5432/db",
      "vaultMapping": {
        "local": {
          "api":      { "key": "42ca7e7f-b26f-4f9c-a5e8-8fbb4c6154ec" },
          "tracking": { "key": "42ca7e7f-b26f-4f9c-a5e8-8fbb4c6154ec" }   // same key ⇒ shared value
        },
        "production": {
          "api":      { "key": "d6a1f0c9-…" },
          "tracking": { "key": "0b8e22aa-…", "disabled": true }           // wired, emitted commented-out
        }
      }
    }
  },

  "compose": { "files": ["docker-compose.yml"] }
}
```

### Reading rules

- **Wired** = the mapping entry exists. **Unwired** = no entry. There is no
  on-disk inference of wiring (v1's drift-derived wiring is gone).
- **`disabled: true`** keeps the wiring but renders the line commented out
  (`# DATABASE_URL=…`) — v1's "unapplied", now explicit in config. It does not
  affect interpolation: a disabled variable's value can still feed another
  variable's reference.
- **All values live in vaults.** Secrets and non-secrets alike. The registry is
  always safe to commit and diff.
- **Key conventions:** the `menv-local` provider allocates opaque UUID keys on
  `wire`. Future remote providers propose meaningful paths (`api/DATABASE_URL`);
  `--key` overrides either.
- **Validation:** every `groupKey`, vault name, consumer name, and compose file
  referenced anywhere must exist. `menv check` and every command that loads the
  registry validate the schema (and `schemaVersion`) before acting.

### File strategies

| `strategyType` | Files written | Notes |
|---------------|---------------|-------|
| `single` | `baseDir/filename`, materialized from one vault: `--vault X` or `defaults.vault` | The everyday local-dev shape. |
| `per-vault` | One file per entry in `strategyConfig.filenames` (vault → filename), all written by one `generate` | The "framework reads `.env.development` / `.env.production`" shape. |

Strategy options (both types):

- `secretsAsLocalOverrides: true` — variables flagged `secret` are written to
  `<filename>.local` (e.g. `.env.development.local`) instead of the main file,
  so the main file can be committed if the user chooses.
- `example: true` — also emit a committed, values-free `.env.example` in
  `baseDir`, built from each wired variable's `example` field.

File strategies are an internal extension point shaped like vault providers
(a `strategyType` registry), so new layouts can be added without touching the
generator core.

## Modular vaults

### Provider contract (public, documented)

```ts
interface VaultProvider {
  readonly type: string;                                   // "menv-local"
  init(config: unknown, auth: VaultAuth): Promise<VaultSession>;
}
interface VaultSession {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
  close(): Promise<void>;
}
```

Providers register in an internal map keyed by `vaultType`. v2.0 compiles in
exactly one provider; the contract — not the provider count — is the
deliverable that satisfies "modular vaults". Adding a provider must require
zero changes outside the provider module and the registry map. This keeps
`bun --compile` single-binary builds working; dynamic npm loading is roadmap
and slots into the same map.

### The `menv-local` provider

- Storage: one JSON file (`vaultConfig.filename`), a flat `{ key: value }` map,
  keys are UUIDs.
- **Encryption is optional and is a feature of this provider** (requirement 13):
  - `encryption: true` — the file is age-encrypted ciphertext (the v1 `age`
    dependency carries over). Committable.
  - `encryption: false` — plaintext JSON. **Must be git-ignored**; `init` adds
    the ignore entry and `menv check` errors if a plaintext vault file is
    tracked by git.
- Multi-line values remain unsupported in v2.0 (unchanged from v1); the local
  vault stores single-line strings. Lifting this is roadmap.

### Auth resolution

Per vault, first hit wins. Applies to any provider; for `menv-local` the
"auth" is the encryption passphrase/key.

1. CLI flag: `--vault-auth <vault>=<secret>` (works, discouraged — shell history).
2. Environment: `MENV_VAULT_AUTH_<VAULT_NAME>` (uppercased, non-alphanumerics → `_`).
3. Auth file: `.menv/auth.local.json` — per-machine, git-ignored, never committed.
4. Interactive masked prompt — **only if stdin is a TTY**.
5. Hard error (exit 3) naming the vault and listing the four supply paths.

```jsonc
// .menv/auth.local.json — three source types cover every secret manager,
// because `op read`, `security find-generic-password`, … are just commands.
{
  "local":      { "type": "command", "command": "op read 'op://Private/menv myrepo/key'" },
  "production": { "type": "env", "name": "MENV_PROD_KEY" }
  // { "type": "value", "value": "…" } also works — discouraged.
}
```

This replaces v1's `[key_backend]` (keychain / 1password / password backends):
the same capabilities are now reachable through `command`-type auth hooks
without menv knowing about specific secret stores.

## Interpolation & globals

Hybrid expansion at generate time:

- `${NAME}` where `NAME` is a **variable** wired to the same consumer in the
  same vault → menv substitutes the (recursively expanded) value.
- `${NAME}` where `NAME` is a **global** with `source: "static"` for that vault
  → menv substitutes the configured value.
- `${NAME}` where `NAME` is a **global** with `source: "runtime"` for that
  vault → the reference is emitted **literally** for the platform (Coolify,
  docker compose) to resolve at run/deploy time.
- `$${` escapes a literal `${`.
- An unresolvable name, or a reference cycle, aborts generation with a clear
  error before any file is written.

Worked example (`PUBLIC_URL = "https://${COOLIFY_FQDN}/api"`,
`HEALTH_URL = "${PUBLIC_URL}/health"`):

```text
# generated from vault "local"            # generated from vault "production"
PUBLIC_URL=https://localhost:3000/api     PUBLIC_URL=https://${COOLIFY_FQDN}/api
HEALTH_URL=https://localhost:3000/api/health
                                          HEALTH_URL=https://${COOLIFY_FQDN}/api/health
```

### Dependency detection (requirement 9)

Reference extraction is a pure function over vault values, so dependency
analysis requires opening the vaults involved. `menv var remove`,
`menv global remove`, `menv unwire`, and `menv vault remove` scan reachable
values for `${NAME}` references to what is being removed:

- Dependents found → the plan carries a `DEPENDENT_REFERENCE` blocker listing
  each dependent (variable, vault, consumer). Execution fails with exit 1
  unless `--force`.
- A vault that can't be opened (no auth) → the plan carries a
  `UNVERIFIED_REFERENCES` warning naming the vault; `--force` is required to
  proceed past it.
- After a `--force` removal, `menv check` and `generate` both surface the now
  broken references.

## Generation

`menv generate [--vault X] [--consumer Y]` is the **only** command that writes
generated files. Pipeline:

```text
load menv.json → validate
→ open only the vault sessions actually needed for the selection
→ fetch mapped values
→ build interpolation graph → expand (rules above; cycles/unresolved abort)
→ render per consumer strategy
→ fill compose marker regions + write .env.compose per compose-file directory
→ atomic writes (tmp + rename), only files whose content changed — no backups
→ report written / unchanged / refused (foreign ownership) files
```

### Generated file anatomy

```dotenv
# ── managed by menv ─ DO NOT EDIT ────────────────────────────
# Generated from menv.json · vault: local · consumer: api
# Re-create with `menv generate`; your edits will be overwritten.

# ── Database ──
DATABASE_URL=postgres://localhost:5432/app
# DB_POOL_SIZE=10

PUBLIC_URL=https://localhost:3000/api
```

- Variables are sorted by group (groups in registry order, ungrouped last),
  then by name; each group renders a `# ── <title> ──` header.
- `disabled` mappings render commented out.
- The first line is the **ownership marker**.

### The ownership rule (requirement 5)

menv only ever overwrites or deletes a file whose first line carries the
ownership marker (or that it is creating fresh). A generated path whose marker
has been removed or replaced by hand is **left untouched and reported** — the
user has taken ownership.

`menv consumer remove <name>`:

- default — **release**: strip the disclaimer header from each of the
  consumer's generated files and leave the contents in place as plain env
  files; remove the consumer and its mapping entries from the registry.
- `--delete-files` — delete the consumer's generated files (marker-checked)
  instead of releasing them.
- Either way, the consumer's compose marker regions in registered compose
  files are emptied, and the report names the marker pairs the user should now
  delete by hand.

### Compose integration (requirement 12)

- The registry's `compose.files` array is the complete list of compose files
  menv touches — `menv compose bind <file>` / `unbind <file>` edit the list;
  no scanning.
- Marker pairs inside a service's `environment:` block are **hand-authored by
  the user** (`# <menv:api>` … `# </menv>`); menv never inserts or deletes
  markers, only rewrites the lines between them:
  `- DATABASE_URL=${API_DATABASE_URL}` — one line per variable wired to that
  consumer in the selected vault, interpolation key prefixed with the consumer
  name so two services never collide.
- Values land in a generated `.env.compose` beside each compose file (one per
  directory; disclaimer header; `disabled` entries commented out). Run with
  `docker compose --env-file .env.compose up`.
- A marker naming an unknown consumer fails `generate` and is reported by
  `check`. A registered file with no markers is fine (warned by `check` as
  probably-unintended).

### .gitignore management

`menv init` writes a managed block. `menv consumer add/update` appends the
consumer's generated paths to it by default (`--no-gitignore` opts out — e.g.
when committing a secrets-free `.env.development` is intentional; with
`secretsAsLocalOverrides`, the `.local` companion is always added).
`menv check` errors when a secret-bearing generated file or a plaintext local
vault file is tracked by git.

```gitignore
# menv (managed block)
.menv/auth.local.json
.menv/backups/
apps/api/.env
apps/web/.env.development.local
apps/web/.env.production.local
.env.compose
```

## CLI surface

Built on commander v15 + extra-typings per the 2026-06-11 spec (grouped help,
did-you-mean, hard errors on unknown flags, hand-emitted zsh/bash completions
with the drift-guard test). Management commands are noun-verb; high-frequency
value operations stay top-level.

```text
menv init [--encrypt|--no-encrypt]      Create an empty registry + local vault + .gitignore block.
                                        Refuses if v1 files (menv.toml) are present. No scanning.

Management (noun-verb):
  menv vault     add <name> --type menv-local [--config k=v,…] | update | remove [--force] | list | show <name>
  menv consumer  add <name> --strategy single|per-vault --base-dir <dir>
                            [--filename <f> | --filenames v1=f1,v2=f2]
                            [--secrets-as-local-overrides] [--example] [--no-gitignore]
                 update <name> […] | remove <name> [--delete-files] | list | show <name>
  menv group     add <key> --title <t> | update | remove [--force] | list
  menv global    define <NAME> --vault <v> (--runtime | --value <val>) | update | remove [--force] | list
  menv compose   bind <file> | unbind <file> | list

Variables & values:
  menv var define <NAME> [--group <key>] [--secret] [--description <t>] [--example <t>]
  menv var update <NAME> [same flags; --no-secret, --group "" to clear]
  menv var remove <NAME> [--force]
  menv var list [--vault v] [--consumer c] [--group g] | menv var show <NAME>

  menv wire    <NAME> --vault <v> --consumers a,b[,…] [--shared] [--key <k>]
  menv unwire  <NAME> --vault <v> --consumers a,b[,…]
  menv enable  <NAME> --vault <v> --consumer <c>
  menv disable <NAME> --vault <v> --consumer <c>

  menv set <NAME> --vault <v> [--consumer <c>] [value]     value: arg | stdin | TTY masked prompt
  menv get <NAME> --vault <v> [--consumer <c>]              raw value to stdout, no trailing newline
  menv import <file> --consumer <c> --vault <v>             explicit .env ingestion

Materialize & verify:
  menv generate [--vault X] [--consumer Y]
  menv check
  menv backup | menv restore <key> [--force]
  menv completions zsh|bash
```

Semantics worth pinning:

- `wire` creates mapping entries. On `menv-local` it allocates one fresh UUID
  per consumer — or one shared UUID for all listed consumers with `--shared`.
  `--key` points at an existing key instead (how you join an existing shared
  value after the fact).
- `unwire` removes mapping entries and deletes a local-vault key when the last
  mapping referencing it goes (after the dependency scan).
- `set`/`get` need `--consumer` only when the name's keys differ between
  consumers within that vault; with a single shared key it is unambiguous.
  Ambiguity without `--consumer` is an error that lists the options, never a
  guess.
- `import` parses a dotenv file; for each entry it defines the variable if new
  (with name-based secret detection, reported per variable and overridable
  later via `var update`), wires it to the consumer in the vault, and sets the
  value. Existing variables are wired + set, not redefined; a value conflict
  with an already-shared key is a blocker (resolved by `--force` splitting the
  consumer onto its own key). Like every mutator, it supports `--dry-run`.

### Contracts

| Contract | Behavior |
|----------|----------|
| **Plan-then-execute** | Every mutating command computes a `Plan` — registry diff, vault operations, file writes/releases/deletes, blockers, warnings — then executes it. `--dry-run` prints the plan and skips execution (exit 0). Blockers fail execution (exit 1) unless `--force`. |
| **Output modes** | `--output pretty\|json` everywhere; default `pretty`; `MENV_OUTPUT` overrides the default. JSON envelope: `{"ok":true,"result":…}` / `{"ok":false,"error":{"code","message","details"}}`. `get` in pretty mode prints the raw value only (no envelope) so `$(menv get …)` works; secrets render as `***` in `pretty` list/show/plan output and are **never** included in `--output json` plans (key names only). |
| **Mutation ≠ generation** | Registry/vault mutations never touch generated files. `generate` is the only writer; `check` reports staleness. (v1's regenerate-on-every-mutation is intentionally gone.) |
| **Non-interactive promise** | No TTY ⇒ no prompts, ever. Missing input is a hard error naming the flag/env var that supplies it. `--yes` answers confirmations (e.g. `restore` overwrite). |
| **Exit codes** | `0` success (incl. `--dry-run`) · `1` domain error / blockers / `check` findings · `2` usage error · `3` auth failure · `4` vault I/O failure. |

```text
$ menv var remove API_HOST --dry-run --output json
{ "ok": true, "result": { "plan": {
    "registry": [{ "remove": "variables.API_HOST" }],
    "vaults":   [{ "vault": "local", "remove": ["9f31bc02-…"] }],
    "files":    [],
    "blockers": [{ "code": "DEPENDENT_REFERENCE",
                   "message": "PUBLIC_URL references ${API_HOST} (vault local, consumer web)" }]
} } }
```

### `menv check`

Read-only repo health gate; exit 1 on any error-level finding.

Validates: registry schema + `schemaVersion`; referential integrity (groups,
vaults, consumers, compose files); interpolation graph (unresolvable refs,
cycles) for every vault it can open — unopenable vaults are reported as
warnings, not silently skipped; vault key existence for every mapping;
compose markers ↔ registry agreement; ownership-marker presence on expected
generated files; staleness (a generated file differing from what `generate`
would write); git-tracking violations (secret-bearing generated files,
plaintext vault files).

### Worked workflows

```bash
# Bootstrap (human, laptop)
menv init --encrypt
menv consumer add api --strategy single --base-dir apps/api --filename .env
menv import apps/api/.env --consumer api --vault local
menv vault add production --type menv-local --config filename=.menv/vault.production.json,encryption=true
menv wire DATABASE_URL --vault production --consumers api
printf '%s' "$PROD_URL" | menv set DATABASE_URL --vault production
menv generate

# CI (no TTY)
export MENV_VAULT_AUTH_PRODUCTION="$VAULT_KEY"
menv check --output json || exit 1
menv generate --vault production --output json

# AI agent making a change safely
menv var define REDIS_URL --group db --secret --output json
menv wire REDIS_URL --vault local --consumers api,worker --shared --output json
menv set REDIS_URL --vault local "redis://localhost:6379" --dry-run --output json   # preview
menv set REDIS_URL --vault local "redis://localhost:6379" --output json
menv check --output json
```

## Backups (requirement 3)

Explicit only. Nothing snapshots automatically — v1's pre-write copies in
`atomicWrite` are removed.

- `menv backup` — snapshot into `.menv/backups/<timestamp>/`: `menv.json`,
  every `menv-local` vault file (ciphertext as-is), and every generated file
  currently carrying the ownership marker.
- `menv restore <key> [--force]` — restore a snapshot. On a TTY with no key,
  presents a picker; without a TTY a key is required. `--force` skips the
  overwrite confirmation (`--yes` also answers it).
- Remote vaults (when they exist) are never backed up by menv — that's the
  remote store's job.

## Referential integrity on removal

| Command | Default | With `--force` |
|---------|---------|----------------|
| `var remove` | Blocked if `${NAME}` is referenced by any reachable value | Removes; dependents become `check`/`generate` errors |
| `global remove` | Same as `var remove` | Same |
| `unwire` | Blocked if the removed consumer's value feeds a reference for that consumer | Removes mapping (+ orphaned local key) |
| `group remove` | Blocked if any variable has the `groupKey` | Clears `groupKey` on those variables |
| `vault remove` | Blocked if any `vaultMapping`/`globals` entry targets it | Removes those entries (vault file/store itself is never deleted) |
| `consumer remove` | Releases files (strips disclaimers). No reference blockers: refs resolve within one (vault, consumer) scope, so removing whole scopes can't break a surviving reference. Orphaned compose markers are reported by `menv check`. | `--delete-files` deletes the consumer's generated files instead of releasing them |

## Architecture & source layout

The v1 layering survives (pure core, effectful io, thin cli); the modules are
reorganized around the new seams:

```text
src/
├─ cli/        # one handler per command; program.ts builds the commander tree
├─ core/       # registry model, types, plan computation, interpolation graph — pure, no I/O
├─ registry/   # menv.json load/validate/save (schema + schemaVersion gate)
├─ vault/      # VaultProvider contract, provider registry, providers/local.ts (age encryption), auth resolution
├─ generate/   # strategies, renderers, disclaimer/ownership, compose splicing, .gitignore block
└─ io/         # dotenv parse/serialize (kept from v1), atomic writes (without auto-backup), backups
tests/         # mirrors src/ one-to-one (bun:test)
```

Carried over from v1: the dotenv parser/serializer, the age encryption
machinery (now inside the local provider), atomic write (minus snapshots), the
compose region splicer, commander program patterns. Deleted: discovery/scan,
drift reconciliation, the TOML persistence layer, key backends
(superseded by auth hooks), the TUI (returns later on the v2 core).

## Testing strategy

- `bun:test`, `tests/` mirrors `src/` (unchanged conventions; `.disk.test.ts`
  suffix for filesystem suites).
- **Plan tests**: every mutator's plan is a pure value — assert plans (diffs,
  blockers) without touching disk; execution tested separately. This is what
  makes requirement 10 cheap to verify.
- **Provider contract suite**: one reusable test suite run against any
  `VaultProvider` (v2.0: `menv-local` in both encryption modes) so future
  providers inherit their conformance tests.
- **Generation fixtures**: registry + vault fixtures in, expected file trees
  out — covering strategies, interpolation (incl. runtime pass-through,
  escapes, cycles), disclaimers, ownership-rule refusals, compose regions.
- **CLI mapping tests**: commander program built with injected handler doubles
  (pattern from the framework spec), asserting parse → options shape, plus the
  JSON envelope and exit codes.
- **`check` fixtures**: one broken repo per finding type, asserting code +
  exit 1.

## Docs impact

README is rewritten for v2 (concepts, registry reference, CLI reference,
auth/encryption, compose, CI). CLAUDE.md updates: layout/commands, the new
boundaries (mutation ≠ generation; ownership rule), removal of key-backend
language. The `menv-usage` agent skill is regenerated against the v2 grammar.

## Out of scope (v2.0) / roadmap

- **Remote vault providers** — HashiCorp Vault, AWS SSM Parameter Store —
  first candidates to prove the provider contract.
- **npm-loaded vault plugins** (`vaultPlugin: "@scope/pkg"`) once a real
  third-party need exists.
- **`menv run -- <cmd>`** — inject a consumer's resolved env into a child
  process without writing files.
- **`menv apply`** — atomic JSON batch mutations on stdin (the AI-agent bulk
  surface).
- **`menv diff`** — headless vault-vs-disk drift report (until then, `check`'s
  staleness finding covers the CI need).
- **TUI v2** — own brainstorm + spec, consuming the same core.
- **Multi-line values**, value history/audit log, drift *import* (v1's
  reconciliation flow).
