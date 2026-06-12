# menv v2 — TUI Design Brief

**Purpose:** a complete, self-contained feature inventory + context to feed a UI
generator (Claude Design) for the menv v2 interactive TUI. menv v2.0 ships
CLI-only; this brief describes the TUI to be built on top of the same v2 core.

**Target medium:** a keyboard-first **terminal UI** — a monospace character grid,
a small set of accent colors, full keyboard navigation (no required mouse). Not a
web app.

> **Layout is intentionally unspecified.** This brief describes *what* the
> interface must let a user see and do, the data it manipulates, the states it
> must represent, and the behaviors it must honor. It deliberately does **not**
> prescribe screens, panes, navigation structure, or visual arrangement — those
> are for the design to invent.

---

## 1. What menv is (one paragraph for the designer)

menv manages environment variables across a monorepo. It separates three things
that tools usually conflate:

- **Structure** lives in one committed registry file, `menv.json` — *which*
  variables exist, who consumes them, how they map into vault keys. Never holds a
  value.
- **Values** live in pluggable **vaults** (v2.0 ships one provider, `menv-local`,
  a JSON file optionally age-encrypted). A vault is *also* the context you
  generate for — "generate for production" = "generate from the `production`
  vault." There is no separate "environment" entity.
- **Outputs** are plaintext `.env` files (and docker-compose regions). They are
  **generated**, git-ignored, and never hand-edited — rewritten on demand by
  `menv generate`.

The user edits structure and values; menv generates outputs; `menv check`
reports any drift between them.

## 2. The five mental-model rules the UI must make obvious

These are the load-bearing concepts. The TUI's whole job is to make them legible.

1. **Structure vs Values vs Outputs are different layers.** The UI edits the
   first two; it *previews/regenerates* the third. Generated files are never
   shown as editable.
2. **Vault = environment = generation context.** Choosing a vault is choosing an
   environment. Multiple vaults can even be the same provider type with different
   config (e.g. `local`, `production`).
3. **Mutation ≠ generation.** Editing the registry or a value NEVER writes a
   `.env`. Generation is a separate, explicit action. The UI must show when
   outputs are *stale* relative to structure/values.
4. **Plan-then-execute.** Every mutation computes a plan (registry diff + vault
   ops + file ops + blockers + warnings) before applying. The UI should surface
   that plan as a confirmation/preview (this is the dry-run model made visual).
5. **Ownership rule.** menv only overwrites/deletes a generated file whose first
   line carries its "managed by menv" marker. A file the user took over (marker
   removed) is left untouched and flagged. The UI must distinguish *managed*,
   *foreign*, and *stale* files.

Plus one cross-cutting rule: **secrets are masked everywhere** (`***`) and only
revealed on an explicit, deliberate action.

## 3. Core data model (entities the UI navigates)

The registry (`menv.json`, `schemaVersion: 2`) is the root object. Entities:

| Entity | Key fields | Relationships / notes |
|---|---|---|
| **Registry** | `defaults.vault` | Root; one per repo. Has a single default vault. |
| **Vault** | `name`, `vaultType` (`menv-local`), `vaultConfig` (`{ filename, encryption }`) | The value store + generation context. One is the default. `encryption: true` ⇒ committable ciphertext; `false` ⇒ plaintext, must be git-ignored. |
| **Consumer** | `name`, `strategyType` (`single` \| `per-vault`), `strategyConfig` | Recipient of generated files. `single` = one `baseDir/filename`. `per-vault` = one file per vault (`filenames: { vault → file }`). Options: `secretsAsLocalOverrides` (secrets → `<file>.local`), `example` (also emit committed `.env.example`). |
| **Variable** | `name` (globally unique), `groupKey?`, `secret?`, `description?`, `example?`, `vaultMapping` | The thing you set values for. `vaultMapping` is the wiring relationship below. |
| **Wiring** | `vaultMapping[vault][consumer] = { key, disabled? }` | The existence of this entry = the variable is *wired* for that (vault, consumer). `key` names where the value lives in the vault. **Two consumers with the same `key` share one value.** `disabled: true` keeps the wiring but renders the output line commented-out. |
| **Group** | `key`, `title` | Display label only — section headers in listings & generated files. No storage/generation semantics. |
| **Global** | `name`, `description?`, `values: { vault → (runtime \| static+value) }` | A name menv may interpolate but does not own. Per vault it is `runtime` (platform supplies it; reference passes through literally) or `static` (menv substitutes the configured value). |
| **Compose binding** | `compose.files: string[]` | Registered docker-compose files menv fills marker regions in. |
| **Backup** | snapshot key (timestamp) | `.menv/backups/<timestamp>/` containing `menv.json`, vault files, marked generated files. |
| **Auth** (not in registry) | per-vault secret | Resolved per vault for `menv-local` = the encryption passphrase. Resolution order: `--vault-auth` flag → `MENV_VAULT_AUTH_<VAULT>` env → `.menv/auth.local.json` hook → masked prompt. The TUI may need to prompt (masked) to open an encrypted vault. |

**The core relationship is three-way:** each `(variable, vault, consumer)` maps
to a vault key — and shared keys mean shared values. Reading and editing this
relationship is the heart of the tool; *how* to present and edit it is open to
the design.

### Per-cell wiring states the UI must be able to represent

For a given Variable × Vault × Consumer combination:

- **unwired** — no mapping entry.
- **wired, has value** — mapping entry + a value present in the vault.
- **wired, missing value** — mapping entry but no value yet in the vault.
- **wired, disabled** — emitted commented-out (`# NAME=…`).
- **shared key** — two+ consumers point at the same key (one value, shared).

## 4. Complete feature / action inventory

Every menv capability that should be reachable in the TUI, grouped by noun. Each
maps to one or more CLI commands (shown for reference). Mutating actions should
flow through the **plan → confirm → apply** behavior (§5).

### Repo-level / lifecycle
- **Initialize repo** — create `menv.json` + local vault + `.gitignore` block;
  choose encrypted (default) or plaintext local vault. (`init [--encrypt|--no-encrypt]`)
  Refuses if v1 files (`menv.toml`) exist.
- **Generate outputs** — regenerate `.env` files + compose regions + `.env.compose`.
  Scope selectors: a target **vault**, and optionally a single **consumer**
  (limiting to one consumer skips compose). Shows a written/unchanged/refused
  report. (`generate [--vault X] [--consumer Y]`)
- **Check / health gate** — run all validations; show findings with severities. (`check`)
- **Import a dotenv file** — ingest an existing `.env`: for each entry define the
  variable (with name-based secret detection), wire it to a consumer in a vault,
  and set the value. (`import <file> --consumer <c> --vault <v>`)
- **Backup** — snapshot registry + vaults + marked generated files. (`backup`)
- **Restore** — pick a snapshot and restore it (with overwrite confirmation). (`restore [key]`)
- (CLI-only, likely omit from TUI: `completions zsh|bash`.)

### Vaults
- **Add vault** — name + type (`menv-local`) + config (`filename`, `encryption`). (`vault add`)
- **Update vault** — merge config keys; **set as default**. (`vault update --config … --default`)
- **Remove vault** — blocked if any mapping/global targets it (override with force;
  the vault store file itself is never deleted). (`vault remove`)
- **List / inspect vaults** — show type, config, encryption mode, default state. (`vault list|show`)
- **Encryption mode** is a `vaultConfig` field (encrypted vs plaintext).
- **Provide auth** to open an encrypted vault (masked prompt) when needed.

### Consumers
- **Add consumer** — name; strategy `single` (→ `--filename`) or `per-vault`
  (→ `--filenames vault=file,…`); `--base-dir`; options
  `--secrets-as-local-overrides`, `--example`, `--no-gitignore`. (`consumer add`)
- **Update consumer** — any of the above. (`consumer update`)
- **Remove consumer** — default **releases** files (strips menv marker, leaves
  content); `--delete-files` deletes them instead. Empties this consumer's
  compose marker regions and reports orphaned marker pairs. (`consumer remove [--delete-files]`)
- **List / inspect consumers** — strategy, baseDir, filenames, options. (`consumer list|show`)

### Variables
- **Define variable** — name; optional `--group`, `--secret`, `--description`,
  `--example`. (`var define`)
- **Update variable** — change group (or clear), toggle secret
  (`--secret`/`--no-secret`), description, example. (`var update`)
- **Remove variable** — blocked if its value is referenced (`${NAME}`) by any
  reachable value; force overrides and leaves dangling refs that `check` flags.
  (`var remove`)
- **List variables** — filter by `--vault`, `--consumer`, `--group`; secrets
  masked; show wiring summary per variable. (`var list`)
- **Inspect variable** — full definition + vaultMapping (masked). (`var show`)

### Wiring (the relationship edits)
- **Wire** — map a variable into a vault key for one or more consumers. Default
  allocates a fresh key per consumer; `--shared` gives all listed consumers one
  shared key; `--key` joins an existing key (how you join a shared value later).
  (`wire <NAME> --vault <v> --consumers a,b [--shared] [--key <k>]`)
- **Unwire** — remove mapping entries (and delete an orphaned local key when its
  last reference goes). Dependency-scanned: blocked if removal breaks a `${ref}`.
  (`unwire <NAME> --vault <v> --consumers a,b`)
- **Enable / Disable** — uncomment / comment-out a wired line for one
  (vault, consumer). (`enable|disable <NAME> --vault <v> --consumer <c>`)

### Values
- **Set value** — for a variable (in a vault; `--consumer` only needed when keys
  differ per consumer). Masked input for secrets. (`set <NAME> [value] --vault <v> [--consumer <c>]`)
- **Get / reveal value** — show the raw value (secrets included) on an explicit
  reveal action. (`get <NAME> --vault <v> [--consumer <c>]`)
- **Ambiguity handling** — when `--consumer` is omitted but keys differ, the UI
  must present the options to choose from, never guess.

### Groups
- **Add / update / remove / list groups** — `key` + `title`. Remove is blocked if
  any variable uses the group (force clears the `groupKey`). (`group add|update|remove|list`)

### Globals
- **Define global** — name, per a vault, exactly one of `--runtime` or
  `--value <static>`; optional `--description`. (`global define`)
- **Update global** — same shape, per vault. (`global update`)
- **Remove global** — `--vault` to remove only one vault's entry, else all;
  dependency-scanned like `var remove`. (`global remove`)
- **List globals** — per-vault source (runtime/static). (`global list`)

### Compose
- **Bind / unbind compose files** — register/deregister a docker-compose file.
  (`compose bind|unbind <file>`)
- **List bound compose files.** (`compose list`)
- (Note: marker pairs inside the compose file — `# <menv:consumer>` … `# </menv>`
  — are **hand-authored by the user**; menv only fills between them. The UI
  explains this, it does not insert markers.)

## 5. The plan / confirm behavior (dominant interaction)

Every mutating action produces a **Plan** before it commits. The TUI should
surface this as a confirmation step (the visual form of `--dry-run`). A plan has
five parts the UI conveys:

- **registry ops** — `set`/`remove` at a dotted path (e.g. `variables.DATABASE_URL`)
  with a human summary.
- **vault ops** — `set`/`remove` of a key in a named vault. **Values are never
  shown in the plan** (secrets stripped) — keys identify the write.
- **file ops** — `write` / `delete` / `release` of a path (these only appear for
  actions that touch generated files, e.g. consumer remove).
- **blockers** — must be resolved or **force-overridden** to proceed.
- **warnings** — surfaced but non-blocking.

Required behaviors:
- **Preview** (no apply) vs **Apply**.
- A **Force / override** for blockers, treated as deliberate/dangerous (e.g.
  removing a referenced variable leaves dangling refs).
- A "no changes" outcome.

Representative blocker/warning codes the UI will show:
- `DEPENDENT_REFERENCE` (blocker) — something `${references}` what you're removing
  (lists each dependent: variable, vault, consumer).
- `UNVERIFIED_REFERENCES` (warning) — a vault couldn't be opened to scan refs;
  force required to proceed.
- value-conflict on import (blocker) — an entry collides with an already-shared
  key (force splits the consumer onto its own key).

## 6. Generate result surface

`generate` is the only writer of outputs. Its result, which the UI conveys:
- **written** (or "would write" in preview) — paths.
- **unchanged** — count (content identical, nothing rewritten).
- **refused** — paths that exist *without* the menv marker (foreign — left as is).
- **warnings** — code + message.
Plus the scope it ran for (vault; optional consumer). Reports **paths, never
content** — though a per-file diff (vault-derived expected vs on-disk) is a
natural enhancement the design may choose to offer.

## 7. Check findings (full surface)

`check` is the read-only health gate (exit 1 on any error-level finding). The UI
conveys findings with severity, code, and message. Complete code set:

**Errors:**
- `INTERPOLATION` — unresolvable `${ref}` or a reference cycle in a scope.
- `MISSING_VALUE` — a wired mapping has no value/key in the vault.
- `FOREIGN_FILE` — a generated path exists but lacks the menv marker (user took
  it over).
- `STALE` — a generated file differs from what `generate` would now write (drift).
- `MISSING_COMPOSE_FILE` — a registered compose file is gone.
- `COMPOSE_MARKER` — malformed marker region in a compose file.
- `COMPOSE_UNKNOWN_CONSUMER` — a marker names a consumer that doesn't exist.
- `PLAINTEXT_VAULT_TRACKED` — a plaintext vault file is tracked by git.
- `SECRET_FILE_TRACKED` — a secret-bearing generated file (or `.env.compose`) is
  tracked by git.

**Warnings:**
- `UNVERIFIED_VAULT` — a vault couldn't be opened (no auth); its checks skipped.
- `COMPOSE_NO_MARKERS` — a bound compose file has no menv markers (probably
  unintended).
- `GIT_UNAVAILABLE` — git not present; tracking checks skipped.
- `ORPHANED_KEY` — a key exists in a vault referenced by no variable (leftover).

## 8. Secrets, masking & auth (security behavior)

- **Mask by default.** In every listing/inspection/plan, a secret value renders
  as `***`. Non-secret values may show inline.
- **Reveal is deliberate.** Revealing a value (the `get` capability) is an
  explicit, per-value action — consider a hold-to-reveal or confirm.
- **Never persist secrets to a preview/plan.** Plans show keys, not values.
- **Vault auth.** Opening an encrypted vault needs its passphrase. If it isn't
  available via flag/env/auth-file, the TUI prompts with a **masked** field. The
  UI should convey which vaults are currently *unlocked* vs *locked* (an unlocked
  vault is needed to read values, run interpolation, and generate for that vault).
- **Encryption status is a first-class signal** per vault: encrypted (safe to
  commit) vs plaintext (must stay git-ignored — flag if it isn't).

## 9. Cross-cutting requirements (not layout)

- **Keyboard-first.** Every action reachable without a mouse.
- **Search / filter** is needed for long lists (variables especially).
- **State distinctions that must be perceivable** (visual encoding is the
  design's choice): error vs warning findings; wired vs unwired; has-value vs
  missing-value; secret vs non-secret; disabled; shared; default vault; locked vs
  unlocked vault; managed vs foreign vs stale generated file.
- **Empty / uninitialized states** with a clear next step (init; add first
  vault/consumer/variable).
- **Drift visibility** is a recurring theme — "your outputs are stale, run
  generate" should be discoverable wherever relevant.
- **Generated files are read-only artifacts** — never presented as editable; the
  path to changing output is edit-structure/value → generate.
- **Destructive actions** (remove, restore, force-override, delete-files) get
  explicit confirmation and clear consequence text.

## 10. Explicitly out of scope (don't invent these)

Roadmap or CLI-only — leave room but don't design them in:
- Remote vault providers (HashiCorp Vault, AWS SSM) — only `menv-local` ships,
  but the **vault add/list capability should accommodate multiple `vaultType`s**.
- `menv run` (inject env into a child process), `menv apply` (batch JSON
  mutations), `menv diff` — roadmap.
- Multi-line values (single-line only in v2.0).
- Value history / audit log.
- Shell completions (`completions zsh|bash`) — CLI-only.

## 11. Appendix — command → action map

| CLI command | TUI capability |
|---|---|
| `init [--encrypt\|--no-encrypt]` | Initialize repo (encrypted/plaintext choice) |
| `generate [--vault X] [--consumer Y]` | Generate outputs (scope selector + result) |
| `check` | Run health check (findings) |
| `import <file> --consumer --vault` | Import a dotenv file |
| `backup` / `restore [key]` | Snapshot / restore |
| `vault add\|update\|remove\|list\|show` | Manage vaults (incl. set default, encryption, config) |
| `consumer add\|update\|remove\|list\|show` | Manage consumers (strategy, options, release vs delete-files) |
| `var define\|update\|remove\|list\|show` | Manage variables (group, secret, description, example) |
| `wire / unwire / enable / disable` | Edit wiring (shared/key; enable/disable per cell) |
| `set / get` | Set value (masked) / reveal value |
| `group add\|update\|remove\|list` | Manage groups |
| `global define\|update\|remove\|list` | Manage globals (runtime vs static per vault) |
| `compose bind\|unbind\|list` | Manage compose bindings |
| `completions zsh\|bash` | (CLI-only — omit) |

**Global flags every action shares (behaviors, not screens):**
`--output pretty\|json` (irrelevant in-TUI), `--dry-run` (→ the plan-preview
behavior), `--force` (→ the override), `--vault-auth` (→ the auth prompt).

**Exit-code semantics (informational):** 0 success · 1 domain error / blockers /
check findings · 2 usage · 3 auth · 4 vault I/O.
