# menv — agent guide

A CLI for managing environment variables across a monorepo. Runtime is **Bun**
(not Node) — `.ts` runs directly, no build step for development. The **registry**
(`menv.json`) is the single source of truth for *structure*; **values live in
pluggable vaults**; plaintext `.env` files are *generated* from the vault on
demand and git-ignored.

Mental model: edit structure (registry) and values (vaults) via the CLI; never
hand-edit a generated `.env` — it is an output, rewritten by `menv generate`.

## Commands

```bash
bun install            # install deps
bun run menv           # run the CLI from source (src/index.ts)
bun run menv init      # create an empty registry + local vault config
bun run menv generate  # vault → .env (+ compose) regenerate
bun run menv check     # validate the repo (CI gate; exit 1 on findings)
bun test               # whole suite
bun test tests/cli/program.disk.test.ts   # a single file
bun run lint           # Biome: lint + import-sort (read-only)
bun run lint:fix       # Biome: apply safe fixes
bun run build          # compile a standalone ./menv binary
```

Full CLI grammar and concepts live in `README.md`. The command set (`init`;
`vault`/`consumer`/`group`/`global`/`compose` management; `var
define/update/remove/list/show`; `wire`/`unwire`/`enable`/`disable`; `set`/`get`;
`import`; `generate`; `check`; `tui`; `backup`/`restore`; `completions`) is built
in `src/cli/program.ts`.

## Structure

- `src/cli/` — commander v15 program (`program.ts`), entry (`index.ts`), command handlers, output/prompt/run plumbing
- `src/tui/` — Ink/React TUI (`menv tui`): `state/` (store, loaders, mutation bridge, pure selectors), `views/`, `modals/`, `input.ts` key router, `keys.ts` keymap (footer + help derive from it). Lazy-imported from `program.ts` so plain CLI runs never load React
- `src/core/` — pure domain: `errors.ts`, `interpolate.ts`, `refs.ts`, `plan.ts`, and the op planners in `src/core/ops/` (no I/O)
- `src/registry/` — `menv.json` types, validation, load/save
- `src/vault/` — `VaultProvider` contract, provider registry, `providers/local.ts` (age encryption), auth resolution
- `src/generate/` — ownership/disclaimer, renderers, consumer paths, compose splicing, the generate orchestrator, file-op applier
- `src/io/` — atomic write, dotenv parse, root discovery, `.gitignore` block, backups
- `tests/` — mirrors `src/` one-to-one (`bun:test`)

On-disk layout `init` creates and the CLI manages:

```text
menv.json              # registry — committed
.menv/vault.json       # menv-local store — committed IF encrypted, git-ignored if plaintext
.menv/auth.local.json  # per-machine vault auth — git-ignored, never committed
.menv/backups/         # `menv backup` snapshots — git-ignored
apps/*/.env            # GENERATED — git-ignored, never hand-edited
apps/*/.env.example    # GENERATED values-free template — committed (per-consumer opt-in)
.env.compose           # GENERATED compose interpolation values — git-ignored
```

## Security model

Values live in vaults, addressed by the keys in each variable's `vaultMapping`;
the registry never contains a value. `menv-local` optionally age-encrypts its
JSON (`encryption: true` ⇒ committable ciphertext; `false` ⇒ plaintext, must
stay git-ignored — `menv check` enforces both). The key resolves per vault:
`--vault-auth <vault>=…`, `MENV_VAULT_AUTH_<NAME>`, a `.menv/auth.local.json`
hook (`command`/`env`/`value`), then a TTY prompt. Anything in `src/vault/` is
security-sensitive.

## Code style

- **Bun-first** — `Bun.file`, `Bun.write`, `Bun.argv`, not the Node equivalents. Top-level `await` is fine.
- **ESM with explicit extensions** — ✅ `from "./cli/program.ts"`  🚫 `from "./cli/program"` (required by `allowImportingTsExtensions`).
- **Named exports only** — 🚫 `export default`. `type`-only imports for types.
- **strict TypeScript** — no `any` escape hatches; model nullability honestly. `biome.json` is the style source of truth.
- Keep `src/io`/`src/vault` effects out of `src/core` (pure ops + interpolation + plan).

## Testing

`bun:test` only (`import … from "bun:test"` resolves only under Bun). `tests/`
mirrors `src/`; `.disk.test.ts` suffix for filesystem suites;
`tests/helpers/fixtures.ts` builds registries/repos.

- Op planners are pure — assert `{ next, plan }` without I/O; secrets must never appear in `planToJson` output.
- Every `VaultProvider` runs the shared conformance suite (`tests/vault/conformance.ts`).
- New behavior needs a test; a fixed bug gets a regression test.

## Mutation ≠ generation

Registry/vault mutations (`set`, `wire`, `var define`, …) NEVER touch generated
files. `menv generate` is the only writer of outputs; `menv check` reports
staleness. Every mutating command supports `--dry-run` and `--output pretty|json`
with a uniform `{ ok, result }` / `{ ok, error }` envelope. Exit codes: 0 success
(incl. dry-run), 1 domain error / blockers / check findings, 2 usage, 3 auth, 4 vault I/O.

## The ownership rule

menv only overwrites or deletes a file whose FIRST line carries the disclaimer
marker (`src/generate/ownership.ts`). A generated path the user has taken over
(marker removed) is left untouched and reported by `check`. `consumer remove`
strips the marker (releasing the file) by default; `--delete-files` deletes it.
Registered compose files are the exception — user-owned, menv only rewrites the
lines between hand-authored `# <menv:consumer>` … `# </menv>` markers.

## Boundaries

- ✅ **Always:** run `bun test` (whole suite) before claiming done. Keep explicit `.ts` extensions and named exports. When a command/flag, on-disk layout, vault provider, or the registry schema changes, update `README.md` in the **same** change (the completion script regenerates from the command tree — keep the drift-guard test passing).
- ⚠️ **Ask first:** changing `menv.json`'s `schemaVersion` or shape (existing repos need migration). Bumping core deps (`bun`, `commander`, `age-encryption`). Anything in `src/vault/` that changes encryption or the provider contract.
- 🚫 **Never:** commit a plaintext `.env`/`.env.*` or a plaintext vault file; print a real secret in code, tests, logs, or a plan (secrets are stripped from `planToJson` for a reason). Hand-edit a generated file — it's an output. Add a default export or reach for a Node API where a Bun one exists.

---
Source of truth: `src/` (behavior), `package.json` (commands/deps), `biome.json`
(style), `README.md` (user-facing), `docs/superpowers/specs/2026-06-12-menv-v2-design.md`
(design). Update when a command/flag, on-disk layout, vault provider, or the
registry schema changes; a core dependency is bumped; or a directory moves.
