# menv

A TUI (Ink + React) for managing environment variables across a monorepo. Values
are stored age-encrypted under `.menv/values/`; structure lives in `menv.toml` and
`.menv/manifest.toml`. The runtime is **Bun** (not Node) — TS/TSX runs directly, no
build step for development.

The secret age identity is held by a **key backend**, chosen at `menv init`
(`--backend keychain|1password|password`) and recorded under `[key_backend]` in
`menv.toml` — see `src/crypto/identity.ts` and `src/crypto/resolveBackend.ts`.
`keychain` (macOS only) and `1password` (`op` CLI) keep the identity in an external
secret store; `password` writes it passphrase-encrypted to a **committed**
`.menv/identity.age` (portable across machines — but anyone with repo access plus
the passphrase can decrypt the vault, so the passphrase is the whole barrier).
Headless `menv generate` takes the password-backend passphrase from
`MENV_PASSPHRASE`.

## Layout

- `src/cli/` — command handlers (`init`, `generate`, `root`)
- `src/core/` — domain model and types
- `src/crypto/` — age encryption, identity, vault
- `src/io/` — discovery, dotenv parsing, file persistence, generation
- `src/store/` — in-memory store, load/save
- `src/ui/` — Ink components, `app.tsx` (the main layout), `scopes.ts`
- `tests/` — mirrors `src/` one-to-one

## Common commands

```bash
bun install            # install deps
bun run menv           # run the CLI from source (src/index.ts)
bun run menv init      # scan the repo, set up the vault, update .gitignore
bun run menv generate  # regenerate .env files from the vault (headless/CI)
bun test               # run the test suite
bun run build          # compile a standalone ./menv binary
```

In a checkout that's already been `bun link`ed, the `menv` binary on `PATH` is
equivalent to `bun run menv`.

## Coding style

- **Bun-first.** Use Bun APIs (`Bun.file`, `Bun.argv`, `Bun.write`) over Node
  equivalents. Top-level `await` is fine.
- **ESM with explicit extensions.** Relative imports include the `.ts`/`.tsx`
  suffix (`./cli/root.ts`) — required by `allowImportingTsExtensions`.
- **Named exports**, no default exports. `type`-only imports for types.
- **`strict` TypeScript.** No `any` escape hatches; model nullability honestly.
- Match the surrounding file's idiom, naming, and comment density. Comments
  explain *why* (e.g. the layout-budget note in `app.tsx`), not *what*.
- Keep functions small and pure where practical; the `io/` and `store/` split
  keeps filesystem effects out of the domain logic.

## Testing

The test framework is **`bun:test`** (not Vitest/Jest — `npx vitest` will fail
because `import ... from "bun:test"` only resolves under Bun).

```bash
bun test                       # whole suite
bun test tests/ui/             # one directory
bun test tests/ui/scopes.test.ts   # one file
```

Conventions:

- Tests live in `tests/`, mirroring the `src/` path of what they cover. Name them
  `<unit>.test.ts` (or `.tsx` for components). Descriptive suffixes are used for
  variants of one unit, e.g. `dotenv.parse.test.ts` / `dotenv.serialize.test.ts`,
  `persist.disk.test.ts` (touches the filesystem) vs `persist.test.ts`.
- Import from `bun:test`: `import { expect, test, describe } from "bun:test";`
- **Always run the suite after changing code and before reporting done.** New
  behavior needs a test; fixed bugs get a regression test.

### Testing the TUI (Ink)

Render components with `ink-testing-library` and assert on `lastFrame()`:

```tsx
import { render } from "ink-testing-library";
const { lastFrame, stdin } = render(<MenvApp store={store} onSaveStamp={() => "s"} viewportRows={24} viewportColumns={100} />);
expect(lastFrame()).toContain("VARIABLES");
```

- Pass `viewportRows` / `viewportColumns` to `MenvApp` for a deterministic size
  instead of relying on the terminal.
- To drive keyboard input, `stdin.write("w")` (or `"\r"` for Enter), then `await`
  a short `setTimeout` so the re-render flushes before reading `lastFrame()`.
- `ink-testing-library` runs in debug mode and concatenates frames, so a frame
  taller than the viewport shows diff/overlap artifacts that do **not** appear in a
  real terminal's alternate screen. Judge correctness by line count and box borders
  closing, not by stray bleed-through text.

### TUI layout invariant

`app.tsx` lays panes out to an exact budget: `topBar(3) + paneHeight + bottomHeight
= rows`. Any modal rendered in the bottom region must have `bottomHeight` set to its
**actual** rendered height (border + content), or it overflows and overlaps the
panes. Modals taller than the viewport (e.g. the wire modal) must window their list
with `listWindow` rather than render every item.
