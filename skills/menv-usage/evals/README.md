# menv-usage skill — eval harness

Reproducible benchmark for the `menv-usage` skill. Each eval is a realistic task a
developer would type in a menv-managed repo. Runs compare **with-skill** vs a
**baseline** (no skill) to measure what the skill actually changes.

## Fixture

A throwaway monorepo, `menv init --no-encrypt`'d so every vault is **plaintext and
git-ignored** — the suite runs fully headless with no passphrase or keychain. (For
an encrypted vault instead, auth resolves from `MENV_VAULT_AUTH_<VAULT>` or
`.menv/auth.local.json`; off a TTY a missing key is a hard error.)

**Vaults** (each `menv-local`, plaintext):

- `local` — the default vault (`defaults.vault`), the everyday dev values.
- `prod` — a second vault (`vault add prod --type menv-local --config
  filename=.menv/prod.json,encryption=false`) — the prod generation context for
  eval 3.
- `localdev` — a per-machine override vault (same shape) — eval 5's `.env.local`
  source.

**Consumers**:

- `web` — `per-vault`, base `apps/web`, filenames `local=.env,localdev=.env.local`,
  `--example`: `NEXT_PUBLIC_API_URL`, `PORT`, `NODE_ENV`.
- `worker` — `single`, `apps/worker/.env`: `REDIS_URL`, `LOG_LEVEL`,
  `QUEUE_CONCURRENCY`.
- `api` — `per-vault`, base `apps/api`, filenames `local=.env,prod=.env.prod`:
  `PORT`, `DATABASE_URL`.

`DATABASE_URL` is wired to `api` only — not `web` (eval 2/3 depend on this), with a
value in both the `local` and `prod` vaults. `NEXT_PUBLIC_API_URL` is wired to
`web` in the `local` vault (its base value); eval 5 adds an override in `localdev`.

Each run gets its own copy of the fixture so runs don't interfere. To let an agent
invoke menv non-interactively, expose `menv` on PATH (or `bun run menv` from the
repo); no auth wrapper is needed since the vaults are plaintext.

## Evals

| id | task | what it probes |
|----|------|----------------|
| 1 | add a Stripe secret to web+worker | secret handling — **stdin vs leaking it as a CLI arg** |
| 2 | web's `.env` is missing `DATABASE_URL` | wiring an existing var to a new consumer **sharing the value** (`--key`), not a fresh empty key or a hand-appended guess |
| 3 | rotate the prod DB password | prod is a **separate vault**: `set --vault prod` + `generate --vault prod`; dev value preserved |
| 4 | a value was hand-added to a generated `.env` | drift: ingest into the vault so it survives `generate` |
| 5 | local-only override of a var | a git-ignored per-machine **vault** → `.env.local`, kept out of `.env.example` |
| 6 | add a multi-line PEM key | awareness of the single-line limitation; no corruption |

`evals.json` holds the prompts and the objective `expectations` per eval. Evals
4–6 are graded with a **durability** check: re-run `menv generate` and confirm the
change survives — i.e. it really lives in a vault, not just a disposable `.env`.

## Results

Grading each run against its `expectations`:

| # | task | with skill | baseline (no skill) |
|---|------|:----------:|:-------------------:|
| 1 | add a Stripe secret to web+worker | 5/5 | 4/5 |
| 2 | wire the missing `DATABASE_URL` | 5/5 | 5/5 |
| 3 | rotate the prod DB password | 4/4 | 4/4 |
| 4 | reconcile a hand-added `.env` value | 4/4 | 4/4 |
| 5 | machine-local override | 5/5 | 5/5 |
| 6 | multi-line PEM key | 4/4 | 4/4 |
| | **total** | **27/27** | **26/27** |

The lone baseline miss is the **guardrail** case (eval 1): without the skill the
secret is passed as a plaintext CLI argument — `menv set STRIPE_SECRET_KEY
sk_test_… ` — leaking it into shell history; with the skill it is piped on stdin
(`printf '%s' "$KEY" | menv set STRIPE_SECRET_KEY`). Both runs store a round-trip
value and flag menv's single-line limit on eval 6, but they differ in fidelity: the
skill folds the PEM to one line with escaped `\n` (which `menv generate` renders as
one dotenv-safe line), while the baseline keeps raw newlines that `generate` emits
as an unquoted multi-line block a standard dotenv parser won't read back as a single
value.

Correctness is otherwise even for a capable agent, so the skill's day-to-day value
is as an **accelerator** — it skips the workflow discovery a cold agent does first
(probing `menv --help`, reading `menv.json`, inferring the model) — and a
**guardrail** that keeps secrets off the command line. Both effects grow with weaker
agents or more obscure menv behavior.

### Time, round-trips, and tokens

All twelve runs execute concurrently under a scheduling cap, so wall-clock time
carries contention and is indicative rather than isolated; the tool-call counts
(Read + Bash invocations) and token counts are concurrency-independent and the
cleaner efficiency signals. With-skill figures already include the one-time read of
`SKILL.md`.

| # | task | time with / base | tool calls with / base | tokens with / base |
|---|------|:----------------:|:----------------------:|:------------------:|
| 1 | add a Stripe secret | 69s / 77s | 7 / 9 | 32.6k / 30.3k |
| 2 | wire the missing var | 95s / 86s † | 9 / 9 | 32.9k / 31.1k |
| 3 | rotate the prod password | 58s / 49s | 7 / 6 | 31.2k / 29.0k |
| 4 | reconcile a hand-added value | 78s / 98s | 8 / 9 | 33.0k / 31.7k |
| 5 | machine-local override | 94s / 125s | 12 / 12 | 34.9k / 35.5k |
| 6 | multi-line PEM key | 102s / 160s | 12 / 15 | 33.8k / 38.1k |
| | **total** | **496s / 595s** | **55 / 60** | **198k / 196k** |

† eval 2's with-skill run is re-run on its own after a transient error, so its time
is not comparable to the concurrent batch.

The baseline spends its extra calls and wall-clock on the tasks it has to
reverse-engineer — evals 4–6, where it reads `--help` and menv's source before
acting. The skill front-loads that knowledge from one `SKILL.md` read, then reinvests
part of the saving into safety previews (`--dry-run`, `check`), which is why on a
lean task like eval 3 it runs a touch longer than a baseline that skips them. Tokens
run nearly even (≈198k vs ≈196k): the skill's small fixed cost — reading `SKILL.md`
plus the extra preview calls — is roughly offset by the tokens the baseline burns
exploring on eval 6.
