# menv — CLI framework re-platform (design)

**Date:** 2026-06-11
**Status:** Design, pending implementation
**Author:** brainstormed with the menv author

## Problem

menv's command surface is a hand-rolled dispatcher. [`src/index.ts`](../../../src/index.ts)
hand-parses `Bun.argv` with a ~30-line `parseArgs`/`flagValue` pair, dispatches
through a long `if/else` chain, and prints a hand-maintained `HELP_TEXT` string
([`src/cli/help.ts`](../../../src/cli/help.ts)). The *user-facing experience* is the
weak point:

- **Help** is a static string that must be edited by hand on every grammar change,
  with no per-command help (`menv set --help` does nothing useful).
- **Errors** are poor. The parser silently treats any unknown `--flag` as a boolean
  and silently swallows excess positionals — a typo'd `--local` on a secret write
  just vanishes. There are no "did you mean" suggestions.
- **Discoverability** is flat: one undifferentiated command list, no grouping.
- **Completions** don't exist. The user is on zsh/macOS and wants tab completion.

The architecture underneath is *already correct*: every `run*` handler in
[`src/cli/`](../../../src/cli/) is a thin wrapper over the shared core
(`src/store`, `src/io`, `src/core`, `src/crypto`), and the TUI consumes that same
core directly. So this is a **surface re-platform**, not an architecture change. The
grammar stays; the parse/dispatch/help/error/completion layer is rebuilt on a
proper framework.

## Decisions (resolved during brainstorming)

1. **Framework: commander v15** (`commander@^15`) with
   `@commander-js/extra-typings@^15` for inferred flag/arg types. Both have zero
   runtime dependencies; extra-typings ships types only. Chosen over stricli
   (bash-only completions), gunshi (DIY error rendering, silent unknown flags), and
   clipanion (frozen, no completions, Default-command degrades help). commander
   delivers all four priorities — grouped/styled help, did-you-mean for commands
   **and** flags, hard errors on unknown flags, and a clean path to zsh completions.
2. **Completions are hand-emitted, not `@bomb.sh/tab`.** tab is pre-1.0 with a peer
   dep pinned to commander 13; our command tree is small and static. A
   `menv completions <zsh|bash>` command prints a hand-written script. (See Risk note.)
3. **Grammar is frozen.** Same command names, same positionals, same flags, same
   value-reading behavior. No new aliases. Every documented invocation works
   byte-for-byte as before.
4. **One intentional behavior change: unknown flags and excess positionals become
   hard errors.** Today they're silently absorbed. For a tool that writes secrets, a
   silently-dropped `--local` is a footgun. Documented in the README.
5. **No `defaultCommand`/root action.** The "no command → launch TUI" path branches
   *before* `parseAsync()`. This is load-bearing: a commander default action would
   swallow typo'd subcommands as excess args and kill did-you-mean.

## Architecture

```
src/index.ts            entry: resolve root → branch (no cmd? TUI : parseAsync) → run* handlers
  └── src/cli/program.ts   buildProgram(root, deps?) → fully configured commander Command
        ├── src/cli/help.ts (rewritten)  group headings, style hooks, examples text
        ├── src/cli/completions.ts (new) emit(shell) + the drift-guard surface list
        └── run* handlers (UNCHANGED)     define/set/get/list/wire/mode/rm/...
```

`src/cli/program.ts` is the one new substantial file. Everything below the handlers
— store, io, core, crypto, the TUI — is untouched.

### `src/cli/program.ts` — `buildProgram(root, deps?)`

Returns a configured `Command`. The signature takes `root` (already resolved by the
entry) and an optional `deps` object whose keys are the `run*` handlers, defaulting
to the real imports. Injecting `deps` lets tests assert the parse→handler mapping
(which positionals/flags reach which handler with what shape) without touching a
real vault. Each subcommand:

- declares its description, arguments (`<name>`, `[value]`), and options;
- is assigned a group heading via `.commandsGroup(...)`;
- has an `.action(async (...) => …)` that translates parsed args into the existing
  handler's options object and calls it — preserving today's exact semantics
  (comma-split scopes via the existing `splitScopes`, `set`'s arg/stdin/prompt value
  read via the existing `readValue`, `get`'s raw no-newline stdout write, etc.).

Program-level config:

- `.showSuggestionAfterError()` — did-you-mean for commands and flags.
- `.showHelpAfterError("(run 'menv <command> --help' for usage)")`.
- `.configureHelp({ … })` style hooks using `node:util`'s `styleText` (bold titles,
  cyan commands, green flags, dim descriptions). Auto-stripped when piped; no chalk.
- `.version(...)` sourced from `package.json` via import (bundles under
  `bun --compile`), removing the duplicated `VERSION = "0.1.0"` constant.
- `.exitOverride()` is **not** set on the production program (commander's
  process.exit behavior is wanted); tests construct their own program with it.

### `src/index.ts` (shrinks to ~25 lines)

1. Resolve `root = await findRepoRoot(process.cwd())`.
2. **Zero args** (`Bun.argv.length <= 2` — no command *and* no flags): keep today's
   behavior exactly — `isMenvRepo(root)` check, else
   `"menv: no menv.toml found. Run \`menv init\` first."`, then `launchTui(root)`
   via the lazy `import("./ui/app.tsx")`.
3. **Any args** (a command, or a bare `--help`/`--version`, or a typo): hand to
   `await buildProgram(root).parseAsync()`. commander prints help/version/
   suggestions as appropriate. (This is why the branch keys on arg *count*, not
   "is there a command word" — `menv --help` must reach commander's help, not the
   TUI.) The top-level `try/catch` mapping thrown domain errors to `stderr` +
   `exit 1` stays.

The lazy-loading discipline is preserved: Ink (`initPrompts.tsx`, `restore.tsx`,
`app.tsx`) is still imported only inside the actions/branches that need a TTY, so
non-interactive runs never pull Ink.

### Help grouping

Four `.commandsGroup(...)` headings:

- **Setup:** `init`, `generate`, `completions`
- **Variables:** `define`, `set`, `get`, `list`, `rm`
- **Wiring:** `wire`, `unwire`, `mode`, `auto-group`
- **Backups:** `backup`, `restore`

The implicit `help` command is assigned to a group (via `.helpCommand(...)`) so it
doesn't dangle in a stray "Commands:" section. Root help gains an examples block and
a line documenting `menv` with no args launches the TUI (currently absent from
`--help`). Per-command help carries examples for the non-obvious flows: set-from-stdin,
wire with multiple scopes, `generate --env`, `init --backend`.

### Completions — `src/cli/completions.ts` + `menv completions <shell>`

- New command prints a static, hand-written completion script for `zsh` (primary)
  and `bash`. The zsh script completes subcommand names with their descriptions,
  per-command flags, and enum values (`--backend keychain|1password|password`,
  `mode`'s `single|perenv`). README documents the one-line install
  (`source <(menv completions zsh)` or persisted to a compdir).
- **Variable-name completion** for `set`/`get`/`rm`/`wire`/`unwire`/`define`: read
  names from the **plaintext** `.menv/manifest.toml`. Verified during exploration:
  [`loadModelParts`](../../../src/io/persist.ts) → `tomlToModelParts(config,
  manifest)` parses the manifest with **no crypto** — a tab-press never triggers a
  Keychain/1Password unlock. The completion script calls a hidden
  `menv __complete-vars` subcommand that prints names one per line. If, during
  implementation, this can't be made clean and unlock-free, **v1 ships static-only**
  (subcommands + flags + enums) and variable-name completion is deferred.
- **Drift guard:** a test enumerates every registered command and every flag from
  the built program and asserts each appears in the emitted scripts, so the
  hand-written script can't silently rot as the grammar grows.

## Compatibility contract

Every documented invocation produces the same observable result as before:

- positionals, `--flag value` pairs, comma-split `--scope a,b,c` and multi-scope
  wire positionals;
- `set`'s value resolution order (arg → stdin → hidden prompt) via `readValue`;
- `get`'s raw stdout with **no** trailing newline (`$(menv get X)` stays clean);
- `backup`'s exact `Backup saved in <rel>` wording (no `menv:` prefix — a test
  locks it);
- the `--with-skill`/`--no-skill`/omitted **tri-state** for `init`;
- `restore`'s TTY requirement and `-f/--force` semantics;
- `init`'s `--backend` validation against `keychain|1password|password`;
- exit codes: 0 on success, nonzero on error.

## Testing

Framework is `bun:test`. New/changed tests:

- **`tests/cli/program.test.ts`** (new) — construct the program with
  `.exitOverride()` and captured output. Assert: grouped help renders the four
  headings; `--version` prints the package version; an unknown command yields a
  did-you-mean; an unknown flag is a hard error (not silently absorbed); the
  no-args path is recognized as "launch TUI" (branch decision, not the Ink render).
  Plus one arg→handler mapping case per command using injected `deps` doubles,
  asserting the handler receives the expected options shape (covers the
  comma-split, tri-state, and `--local` translations).
- **`tests/cli/completions.test.ts`** (new) — `emit("zsh")`/`emit("bash")` contain
  every command and flag (the drift guard); enum values appear for `--backend` and
  `mode`; if variable-name completion ships, `__complete-vars` reads names from a
  fixture manifest **without** a backend.
- **`tests/cli/help.test.ts`** (rewritten) — the current test asserts the static
  `HELP_TEXT` contains every command/flag token. Replace it with an assertion over
  the *generated* help output (same intent: every command is documented), since
  `HELP_TEXT` is being deleted.
- The existing CLI suites (`tests/cli/set.test.ts`, `backup.test.ts`,
  `restore.test.ts`, …) must pass **unmodified** — they exercise the `run*`
  handlers directly, which don't change. The only references to remove are the two
  `HELP_TEXT` imports (`src/index.ts`, `tests/cli/help.test.ts`).

## Docs

- **README** — regenerate the CLI reference from the new grammar (mechanically
  identical commands), add a completions install section, and note the stricter
  unknown-flag/excess-arg validation. (Required by CLAUDE.md Boundaries: a
  command/flag/help change updates the README in the same change.)
- **CLAUDE.md** — add the completion script to the "update in the same change"
  triggers so future grammar changes keep it in sync.

## Risks & mitigations

- **commander v15 is recent (May 2026) and its peers (tab, carapace adapters) lag at
  v13.** Mitigated by *not* depending on any tab adapter — completions are
  hand-rolled. commander v15 itself builds and runs clean under Bun + `bun --compile`
  (verified during research).
- **Hand-written completions rot.** Mitigated by the drift-guard test.
- **Stricter errors break an undocumented invocation someone relied on.** Accepted:
  the silent-absorb behavior was never documented and is unsafe for a secrets tool.

## Out of scope

- Grammar changes, new command names, command aliases.
- TUI changes (it already consumes the core directly).
- Expanding `--json` output beyond today's `list --json`.
- `@bomb.sh/tab` integration (revisit if/when its commander peer dep catches up).
