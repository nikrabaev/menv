<div align="center">

# menv

**A keyboard-driven TUI for managing environment variables across a monorepo —
values age-encrypted in one vault, `.env` files generated on demand.**

<img src="assets/screenshot.png" alt="menv — the three-pane TUI: scopes, variables, and the inspector" width="900">

<sub>Runtime: <b>Bun</b> · UI: <b>Ink + React</b> · Encryption: <b>age</b></sub>

</div>

---

`menv` discovers every `.env` and `docker-compose` service in your repo, lifts the
values into a single **age-encrypted vault**, and gives you a fast keyboard-driven
TUI to edit, group, and **wire** variables to the apps and services that consume
them. The encrypted vault is committed; the plaintext `.env` files are regenerated
on demand and stay git-ignored.

No more "which `.env` has the real `STRIPE_SECRET_KEY`?", no more pasting secrets
into Slack, no more `.env.example` drift.

## Why

A monorepo spreads the same handful of secrets across a dozen `.env` files. Keeping
them in sync — and out of git — is tedious and error-prone. `menv` makes the repo
the **single source of truth**:

- **One encrypted vault, many `.env` files.** Values live once, age-encrypted under
  `.menv/values/`. Each app's `.env` is *generated* from the vault, never hand-edited.
- **Shared vs. owned, made explicit.** A value used by several apps is a *global*;
  one owned by a single app is *local*. You see the difference at a glance.
- **Wiring, not copy-paste.** Decide which apps and services receive a variable;
  `menv` writes it into exactly those `.env` files.
- **Commit the secrets, safely.** The vault is ciphertext. Only the holder of the
  age identity can read it — and you choose where that identity lives.
- **`.env.example` for free.** Regenerated as a committed, values-free template so
  new contributors know what to set.

## Quick start

`menv` runs on [Bun](https://bun.sh) — TypeScript/TSX execute directly, no build step.

```bash
bun install      # install dependencies
bun link         # put `menv` on your PATH (optional)
```

Then, from the root of your repo:

```bash
menv init        # scan the repo, create the vault, update .gitignore
menv             # launch the TUI
```

`menv init` walks your workspace, finds every `.env*` file and `docker-compose`
service, encrypts the discovered values, and asks where to keep the secret key
(see [Key backends](#key-backends)). Run `menv` with no arguments any time to open
the editor.

> Prefer a single binary? `bun run build` compiles a standalone `./menv`.

## The TUI

Three panes, driven entirely from the keyboard:

| Pane | What it shows |
|------|---------------|
| **Scopes** | `All` / `Global`, then your **apps**, **services**, and variable **groups**. Selecting one filters the list. |
| **Variables** | The variables in the current scope, grouped and name-sorted. Secrets render as `***`; unset values show `empty`. |
| **Inspector** | Every field of the selected variable — description, example, group, secret flag, **wiring**, and the value for the active environment. |

The top bar shows the repo, the **environment tabs** (the active one highlighted),
and an unsaved-changes indicator (`* N unsaved` / `saved`).

### Keybindings

| Key | Action |
|-----|--------|
| `↑` `↓` | Move within the focused pane (scope · variable · inspector field) |
| `⇧↑` `⇧↓` *(or `⌥↑` `⌥↓`)* | Jump between group blocks in the variable list |
| `Tab` | Cycle panes: scopes → variables → inspector |
| `Esc` | From the inspector, back to the variable list |
| `Enter` | Edit the focused value / field — or toggle **secret**, or open the **wire** modal |
| `c` | Copy the value (or field) to the clipboard |
| `e` | Switch environment (`dev` → `prod` → …) |
| `/` | Filter variables by name |
| `n` | New variable |
| `x` | Delete the selected variable |
| `s` | Save — encrypt the vault and regenerate every `.env` / `.env.example` |
| `q` *(or `Ctrl+C`)* | Quit — prompts to save if there are unsaved changes |

## Concepts

- **Environments** — `dev`, `prod`, `staging`, … Every variable can hold a distinct
  value per environment. The active environment (top bar, switch with `e`) decides
  which value is written into the generated `.env` files.
- **Global vs. local** — A **global** is shared across apps (`DATABASE_URL`,
  `SENTRY_DSN`). A **local** is owned by a single app (`STRIPE_SECRET_KEY` in `web`).
  `menv init` infers the tier: a name with matching values across two or more apps
  becomes global; everything else stays local.
- **Wiring** — Which consumers (apps / services) actually receive a variable. A
  global can be wired to many; a local is delivered to its owner. On save, `menv`
  writes each variable into exactly the `.env` files of its wired consumers.
- **Secrets** — Flagged variables are masked (`***`) in the UI. The flag is
  auto-detected from the name on `init` (`SECRET`, `TOKEN`, `KEY`, `PASSWORD`,
  `DSN`, `URL`) and toggleable per variable.
- **Groups** — An optional label (`Database`, `Payments`, …) that buckets variables
  in the list and adds a scope in the sidebar.

## Key backends

The vault is encrypted to an **age** recipient (a public key, recorded in
`menv.toml`). Decryption needs the matching **identity** (the private key). Where
that identity lives is your choice at `menv init` — `--backend keychain|1password|password`,
or pick interactively:

| Backend | Where the identity lives | Portability | Trade-off |
|---------|--------------------------|-------------|-----------|
| `keychain` *(macOS)* | macOS login Keychain | This machine / Keychain sync | Most seamless, but macOS-only. |
| `1password` | A 1Password item (via the `op` CLI); only an `op://…` reference is stored in `menv.toml` | Any machine signed in to the vault | Great for teams; requires `op`. |
| `password` | A passphrase-encrypted `.menv/identity.age`, **committed to the repo** | Anywhere — travels with the repo | Fully portable, but the passphrase is the *only* barrier: anyone with repo access **and** the passphrase can decrypt the vault. |

The `password` backend reads its passphrase interactively, or from
`MENV_PASSPHRASE` for headless use.

## CLI reference

```text
menv [command] [options]

  (none)                  Launch the interactive TUI (default)

  init [options]          Scan the repo, set up the vault, update .gitignore
      --backend <kind>      keychain | 1password | password
                            (omit to choose interactively)
      --vault <name>        1Password vault for the new item (default: Private)

  generate [--env <env>]  Regenerate .env files from the vault (headless / CI).
                          The password backend reads MENV_PASSPHRASE.

  backup                  Snapshot every .env and .env.example into
                          .menv/backups/<timestamp>

  restore [key] [-f]      Restore .env / .env.example files from a backup.
                            key            a backup timestamp (omit to pick one)
                            -f, --force    overwrite every file without prompting

  -h, --help              Show help
  -v, --version           Show the version
```

## On-disk layout

```text
your-repo/
├─ menv.toml                 # committed — envs, recipients, apps, services, [key_backend]
├─ .menv/
│  ├─ manifest.toml          # committed — variable definitions (name, tier, group, wiring…)
│  ├─ identity.age           # committed — ONLY for the `password` backend (encrypted key)
│  ├─ values/
│  │  ├─ dev.env.age         # git-ignored — age-encrypted values for `dev`
│  │  └─ prod.env.age        # git-ignored — …one file per environment
│  └─ backups/               # git-ignored — timestamped .env snapshots
├─ apps/web/
│  ├─ .env                   # git-ignored — generated for the active environment
│  └─ .env.example           # committed — values-free template
└─ apps/api/
   └─ …
```

`menv init` appends this block to `.gitignore`:

```gitignore
# menv
.menv/values/
.menv/backups/
.env
.env.*
!.env.example
```

The encrypted vault (`menv.toml`, `.menv/manifest.toml`, `.menv/values/*.age`) is
safe to commit; the plaintext `.env` files are not, and are regenerated on demand.

## Headless / CI

Materialize `.env` files on a build machine without the TUI:

```bash
# keychain / 1password backends use the ambient credential
menv generate --env prod

# password backend: supply the passphrase out-of-band
MENV_PASSPHRASE='…' menv generate --env prod
```

`menv generate` decrypts the chosen environment from the vault and writes each
app's `.env` (plus refreshed `.env.example` templates).

## Development

```bash
bun install            # install deps
bun run menv           # run the CLI from source (src/index.ts)
bun test               # run the test suite (bun:test)
bun run build          # compile a standalone ./menv binary
```

Source is organized by responsibility — domain logic stays free of filesystem and
crypto side-effects:

```text
src/
├─ cli/      # command handlers: init, generate, backup, restore, root
├─ core/     # domain model and types
├─ crypto/   # age encryption, identities, key backends, the vault
├─ io/       # discovery, dotenv/compose parsing, persistence, generation
├─ store/    # in-memory store, load/save
└─ ui/       # Ink components, app.tsx, scopes & grouping
tests/       # mirrors src/ one-to-one
```

## Security model

- Values are encrypted with **age** to a recipient public key in `menv.toml`.
  Reading the vault requires the private identity from your chosen backend.
- With `keychain` / `1password`, the identity never lands in the repo.
- With `password`, the encrypted identity is committed for portability — so the
  **passphrase is the whole barrier**. Choose a strong one, and treat repo access
  plus passphrase as equivalent to full vault access.
- Generated `.env` files and the decrypted `.menv/values/` are git-ignored by
  default; keep them that way.
