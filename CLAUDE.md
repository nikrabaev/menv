> **v2 REWRITE BRANCH.** `src/` is being rebuilt per
> `docs/superpowers/specs/2026-06-12-menv-v2-design.md`. Everything below
> describes v1 and is stale until the docs task in Plan 3. Trust the spec and
> the plans in `docs/superpowers/plans/`, not this file's v1 sections.

# menv — agent guide

A keyboard-driven TUI **and** full CLI for managing environment variables across a
monorepo. Runtime is **Bun** (not Node) — `.ts`/`.tsx` run directly, no build step
for development. UI is **Ink 7 + React 19**; values are **age-encrypted** in one
committed vault and `.env` files are *generated* from it on demand.

The mental model: the vault is the single source of truth. Plaintext `.env` files
are disposable outputs (git-ignored, regenerated). Editing happens in the vault via
the TUI or the CLI — never by hand-editing a generated file.

## Commands

```bash
bun install            # install deps
bun run menv           # run the CLI/TUI from source (src/index.ts)
bun run menv init      # scan repo, create vault, choose key backend, edit .gitignore
bun run menv generate  # one-way vault → .env regenerate (headless/CI)
bun test               # whole suite
bun test tests/io/dotenv.parse.test.ts   # a single test file
bun run lint           # Biome: lint + import-sort check (read-only)
bun run lint:fix       # Biome: apply safe fixes (--unsafe for the rest)
bun run build          # compile a standalone ./menv binary
```

Full CLI grammar, keybindings, and the feature tour live in `README.md` — the
source of truth for user-facing behavior. The full command set (`init`, `generate`,
`define`, `set`, `get`, `list`, `wire`/`unwire`, `mode`, `rm`, `auto-group`,
`backup`, `restore`, plus the no-arg TUI launch) is dispatched from `src/index.ts`;
each handler lives in `src/cli/`. In a `bun link`ed checkout, the `menv` binary on
`PATH` equals `bun run menv`.

## Structure

- `src/cli/` — one command handler per file; dispatch + arg parsing in `src/index.ts`
- `src/core/` — domain model (`src/core/model.ts`) and types (`src/core/types.ts`); pure, no I/O
- `src/crypto/` — age encryption (`src/crypto/age.ts`), the key backends (`src/crypto/identity.ts`, `src/crypto/resolveBackend.ts`), vault read/write (`src/crypto/vault.ts`)
- `src/io/` — filesystem effects: discovery (`src/io/discovery.ts`), dotenv parse/serialize (`src/io/dotenv.ts`), generation (`src/io/generate.ts`), persistence (`src/io/persist.ts`), drift detection (`src/io/drift.ts`)
- `src/store/` — in-memory store (`src/store/store.ts`) plus load/save
- `src/ui/` — Ink components under `src/ui/components/`, the main layout in `src/ui/app.tsx`, scope model in `src/ui/scopes.ts`
- `tests/` — mirrors `src/` one-to-one

The on-disk layout `menv init` creates and `menv` manages (paths are defined as
constants in `src/io/persist.ts` and `src/crypto/identity.ts`):

```text
menv.toml             # config: targets, recipients, [key_backend]   — committed
.menv/manifest.toml   # variable structure: metadata + wiring        — committed
.menv/values/         # age-encrypted values (ciphertext)            — committed
.menv/identity.age    # password backend ONLY: passphrase-encrypted  — committed
.menv/backups/        # vault snapshots (menv backup / restore)
.env, .env.<env>      # GENERATED from the vault — git-ignored, never hand-edited
.env.example          # GENERATED values-free template               — committed
```

## Security model

The vault is encrypted to an **age** recipient; decryption needs the matching
**identity** (private key), held by a **key backend** chosen at `menv init`
(`--backend keychain|1password|password`, recorded under `[key_backend]`):

- `keychain` (macOS only) and `1password` (`op` CLI) keep the identity in an
  external secret store — it never enters the repo.
- `password` writes the identity passphrase-encrypted to a **committed**
  `identity.age` file (see the layout above), portable across machines. The
  passphrase is then the whole barrier: anyone with repo access **plus** the
  passphrase can decrypt the vault.
  Headless `menv generate` reads that passphrase from `MENV_PASSPHRASE`.

Because the vault ciphertext is committed but the identity backing varies, treat
anything that touches `src/crypto/` as security-sensitive (see Boundaries).

## Code style

- **Bun-first** — use `Bun.file`, `Bun.write`, `Bun.argv`, not the Node equivalents. Top-level `await` is fine.
- **ESM with explicit extensions** — ✅ `import { runInit } from "./cli/init.ts"`  🚫 `from "./cli/init"` (required by `allowImportingTsExtensions`).
- **Named exports only** — ✅ `export function MenvApp(...)`  🚫 `export default`. `type`-only imports for types.
- **`strict` TypeScript** — no `any` escape hatches; model nullability honestly. Linter/format config is the source of truth: see `biome.json`.
- Keep `src/io/` and `src/store/` effects out of `src/core/` domain logic. Comments explain *why*, not *what* (e.g. the layout-budget note in `src/ui/app.tsx`).

## Testing

Framework is **`bun:test`** (not Vitest/Jest — `import ... from "bun:test"` only
resolves under Bun, so `npx vitest` fails). Run one file with
`bun test <path>` (e.g. `bun test tests/io/persist.test.ts`).

- Tests live in `tests/`, mirroring the `src/` path they cover, named `<unit>.test.ts` (`.tsx` for components). Variant suffixes split one unit: `tests/io/dotenv.parse.test.ts` vs `tests/io/dotenv.serialize.test.ts`; `tests/io/persist.disk.test.ts` (touches the filesystem) vs `tests/io/persist.test.ts`.
- New behavior needs a test; a fixed bug gets a regression test.

### Testing the TUI (Ink)

Render with `ink-testing-library` and assert on `lastFrame()`:

```tsx
import { render } from "ink-testing-library";
const { lastFrame, stdin } = render(
  <MenvApp store={store} onSaveStamp={() => "s"} viewportRows={24} viewportColumns={100} />,
);
expect(lastFrame()).toContain("VARIABLES");
```

- Pass `viewportRows` / `viewportColumns` to `MenvApp` for a deterministic size instead of relying on the terminal.
- To drive input, `stdin.write("w")` (or `"\r"` for Enter), then `await` a short `setTimeout` so the re-render flushes before reading `lastFrame()`.
- `ink-testing-library` runs in debug mode and concatenates frames, so a frame taller than the viewport shows diff/overlap artifacts that do **not** appear in a real terminal's alternate screen. Judge correctness by line count and box borders closing, not by stray bleed-through text.

### TUI layout invariant

`src/ui/app.tsx` lays panes out to an exact budget: `topBar(3) + paneHeight +
bottomHeight = rows`. Any modal in the bottom region must set `bottomHeight` to its
**actual** rendered height (border + content) or it overflows and overlaps the
panes. Modals taller than the viewport (e.g. the wire modal) must window their list
with `src/ui/components/listWindow.ts`, not render every item.

## Boundaries

- ✅ **Always:** run `bun test` (whole suite) before claiming done. Keep explicit `.ts`/`.tsx` import extensions and named exports. When a change alters a command/flag, keybinding, on-disk layout, key backend, or discovery rule, update `README.md` in the **same** change; when the TUI's appearance changes, regenerate `assets/screenshot.png` via the `screenshot-tui` skill (`.claude/skills/screenshot-tui/`).
- ⚠️ **Ask first:** changing the on-disk vault/manifest schema or file naming (existing repos need a migration path). Bumping core deps (`bun`, `ink`, `react`, `age-encryption`) — Ink/React majors ripple through `src/ui/`. Anything in `src/crypto/` that changes the age recipient or key-backend behavior.
- 🚫 **Never:** commit a plaintext `.env`/`.env.*`, or print a real secret value in code, tests, logs, or a PR — secrets render as `***` for a reason; the committed vault must stay ciphertext. Treat a generated `.env` as an output, not a source — edit the vault instead; stray on-disk edits are imported by drift reconciliation at TUI launch (`src/io/drift.ts`, `src/ui/driftReconcile.tsx`). Reference line numbers in docs, or duplicate `package.json`/config bodies — reference the file. Reach for a Node API where a Bun one exists, or add a default export.

## Deep docs

- User-facing front door, full CLI reference, keybindings, concepts → `README.md`.
- Screenshot regeneration skill → `.claude/skills/screenshot-tui/`.

---
Source of truth: `src/` (behavior), `package.json` (commands/deps), `biome.json`
(style), `README.md` (user-facing). Update when: a command/flag, keybinding,
on-disk layout, key backend, or discovery rule changes; a core dependency is
bumped; or a directory moves.
