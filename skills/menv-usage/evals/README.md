# menv-usage skill — eval harness

Reproducible benchmark for the `menv-usage` skill. Each eval is a realistic task a
developer would type in a menv-managed repo. Runs compare **with-skill** vs a
**baseline** (no skill) to measure what the skill actually changes.

## Fixture

A throwaway monorepo, `menv init`'d with the **password** backend (so it decrypts
headlessly via `MENV_PASSPHRASE`, touching no real keychain/1Password):

- `apps/web` (single mode): `PORT`, `NODE_ENV`, `NEXT_PUBLIC_API_URL`
- `apps/worker` (single mode): `REDIS_URL`, `LOG_LEVEL`, `QUEUE_CONCURRENCY`
- `apps/api` (perenv mode, dev+prod): `PORT`, `DATABASE_URL`
- `DATABASE_URL` is wired to `api` only — not `web` (eval 2/3 depend on this).

Each run gets its own copy of the fixture so runs don't interfere. To let an agent
invoke menv non-interactively, the fixture carries a `./bin/menv` wrapper that
exports the vault passphrase and calls menv.

## Evals

| id | task | what it probes |
|----|------|----------------|
| 1 | add a Stripe secret to web+worker | secret handling — **stdin vs leaking it as a CLI arg** |
| 2 | web's `.env` is missing `DATABASE_URL` | wiring an existing var, not hand-appending a guess |
| 3 | rotate the prod DB password | `set --env prod` + regenerate; dev value preserved |
| 4 | a value was hand-added to a generated `.env` | drift: import to the vault so it survives `generate` |
| 5 | local-only override of a var | `--local` → `.env.local`, kept out of `.env.example` |
| 6 | add a multi-line PEM key | awareness of the single-line limitation; no corruption |

`evals.json` holds the prompts and the objective `expectations` per eval. Evals
4–6 are graded with a **durability** check: re-run `menv generate` and confirm the
change survives — i.e. it really lives in the vault, not just a disposable `.env`.

## Results

Benchmarked on this session's (capable) model. **With skill** = the current
slimmed `SKILL.md`; **baseline** = no skill. Per-eval assertion scores:

| # | task | with skill | baseline |
|---|------|-----------|----------|
| 1 | add a Stripe secret | 5/5 | 4/5 — leaked the value as a CLI arg |
| 2 | wire a missing var | 5/5 | 5/5 |
| 3 | rotate prod value | 4/4 | 4/4 |
| 4 | drift reconcile | 4/4 | 4/4 |
| 5 | local override | 5/5 | 5/5 |
| 6 | multi-line key | 4/4 | 4/4 |
| | **total** | **27/27 (100%)** | **26/27 (96%)** |

The slimmed skill matches the earlier fuller draft (both 100%), so trimming cost
no correctness. Baselines for evals 4–6 were run **blind** — their prompt never
mentioned menv — yet still recognized the setup (from `menv.toml` / `.menv/`) and
used menv correctly, including drift reconciliation, `--local`, and the multi-line
key. The lone baseline failure was a leaked secret (eval 1: the value passed as a
plaintext CLI argument instead of via stdin).

### Time & cost — the everyday payoff

Correctness is close to a wash for a capable agent; **speed is where the skill
earns its keep day to day.** Knowing menv's commands and mental model up front,
the agent skips the reverse-engineering — probing `menv --help`, reading
`menv.toml`, and inferring the workflow — that a cold agent does first. In the
controlled rounds (with-skill and baseline run together on identical fixtures):

| round | tasks | with skill | baseline | delta |
|-------|-------|-----------|----------|-------|
| 1 | evals 1–3 | 81.5s | 98.9s | **−17.4s (~18% faster)** |
| 2 | evals 4–6 | 135.3s | 147.7s | **−12.4s (~8% faster)** |

Faster on **5 of the 6** tasks. (The exception, eval 6, ran slower *because* the
skilled agent correctly did more — also setting the prod value and cleaning up
scratch files.) The trade-off is a modest token cost: reading the skill adds
~2.5k tokens/run. So the skill **trades a few tokens for wall-clock and fewer
wrong turns** — exactly the trade you want when a human is waiting on the agent.

**Takeaway:** for a capable agent this skill is mainly an **accelerator** (it
shaves ~10–18% off each task by skipping workflow discovery) and a **guardrail**
(it reliably prevents the occasional secret leak), rather than a prerequisite for
correctness. Both effects should grow with weaker agents or more obscure menv
behavior.
