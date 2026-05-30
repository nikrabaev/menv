# menv — Conditional `.env.example`, Example Values, and Value-Aware Sharing

**Date:** 2026-05-30
**Status:** Approved design, ready for implementation planning

## Problem

Three issues with `menv init` and generation today:

1. **`.env.example` spam.** `writeGeneratedFiles` emits a `.env.example` into **every** app/package, even ones with no `.env` and no env variables. Users only want examples where they make sense.
2. **No "example value" concept.** `.env.example` files are regenerated values-free (`KEY=`), and existing `.env.example` files are ignored on import — their documented placeholder values are lost.
3. **Naïve shared detection.** A variable used by ≥2 apps is marked `global` purely by name; the value is stored once per `(name, env)`, so when apps disagree on a value the last-scanned app silently wins. Sharing should be value-aware, and genuinely-divergent values should stay separate.

## Goals

- Generate/regenerate `.env.example` **only** for apps that have a real env file; never create one for apps without a `.env`.
- Add an optional, plaintext **example value** per variable; import it from existing `.env.example` files at init; emit it when regenerating `.env.example`.
- Make shared detection **value-aware**: identical values across apps → one shared `global`; divergent values → per-app `local` variables that each keep their own value.
- Re-key the value store so same-named per-app locals can coexist.

## Non-goals (this change)

- No TUI changes (no inspector/edit surface for example values yet).
- No change to `.gitignore` handling or backups.
- No grouping of partially-agreeing apps (see Decision D3).

---

## Feature A — Conditional `.env.example` generation

`writeGeneratedFiles` writes a consumer's `.env.example` **only when the app has at least one real env file**: `Object.keys(c.envFiles).length > 0`.

- App with a real `.env` (or `.env.<env>`) → `.env.example` is created if missing and regenerated on every save (kept in sync).
- App with no env file at all (library/package) → no `.env.example`, ever.
- App that has only a `.env.example` (no real env file) → `envFiles` is empty → not regenerated; its example is still read on import (Feature B).

Real `.env` files are generated exactly as today. Existing `.env.example` files that menv overwrites are backed up by the existing `backupIfExists` path.

## Feature B — Example values

### Data model
`Variable` gains an optional field:

```ts
export interface Variable {
  // …existing…
  example?: string; // optional placeholder shown in .env.example; one per variable, not per-env
}
```

Stored in the **plaintext manifest** (`.menv/manifest.toml`), never in the encrypted vault — it is a committed, safe placeholder, not a real secret.

### Persistence (`io/persist.ts`)
- `modelToToml`: each variable entry gains `example: v.example ?? ""`.
- `tomlToModelParts`: parse `example: v.example || undefined` (mirrors the existing `ownerApp` optional pattern).

### Generation (`io/generate.ts`)
`renderAppExample` stops passing `valuesFree: true`. Instead each entry's value is the variable's `example` (`KEY=redis://…`), or empty (`KEY=`) when the example is unset. This applies to secret variables too — the example is a deliberate placeholder, so emitting it is intended and safe. `renderAppEnv` (real values) is unchanged.

### Import (`io/discovery.ts`)
Discovery now reads `*.example` env files (today skipped). For each `KEY` in app `a`'s example with placeholder value `EV`:
- If `a` already emits a variable named `KEY` (a global wired to `a`, or a local owned by `a`), set that variable's `example = EV` (first non-empty wins).
- Otherwise (an **example-only key** — present in the example but in no real `.env`), create a **local variable owned by `a`** with `example = EV` and no real value.

Example values never participate in real-value storage and never affect sharing decisions (Feature C).

---

## Feature C — Value-aware sharing and per-app locals

### Discovery rule (real `.env` values only)
For each variable **name**, based on the apps whose real env files define it and the values they assign:

- **1 app** → `local`, owned by that app.
- **≥2 apps, all agree** on the value (in every environment where ≥2 of them define it) → `global` (shared), value = the common value.
- **≥2 apps, any disagreement** → **per-app locals**: every defining app gets its own `local` variable with its own value, owned by itself.

"Disagreement" is evaluated per environment: in any environment where two or more defining apps assign different values to the name, the name is in conflict. The rule is all-or-nothing — see Decision D3.

### Variable ids
Ids stay unique even when names repeat: an id carries its owner app whenever the name could appear on more than one variable; otherwise it is just `var:<NAME>`.

Precise id assignment:

| Case | id |
|---|---|
| name in 1 app (local) | `var:<NAME>` |
| name in ≥2 apps, agree (global) | `var:<NAME>` |
| name in ≥2 apps, conflict (per-app local) | `var:<appId>:<NAME>` (e.g. `var:app:api:NODE_ENV`) |
| example-only key (local) | `var:<appId>:<NAME>` |

Because a name resolves to exactly one of {single local, global, conflicted-locals}, `var:<NAME>` is only ever used when the name maps to a single variable; conflicted/example-only locals always carry the owner app in their id. No id collisions.

### Value store (the change C forces)
A name-keyed store cannot hold two same-named locals, so:

- **The vault keys its contents by variable id, serialized as JSON** (`{ "var:app:api:NODE_ENV": "development", "var:app:web:NODE_ENV": "production" }`), instead of name-keyed dotenv. Colon-bearing ids are not valid dotenv keys; JSON round-trips any string key cleanly. `crypto/vault.ts`'s `saveEnvValues` / `loadEnvValues` keep their `Record<string,string>` signatures; only the internal serialization (dotenv → JSON) and the key meaning (name → id) change. An absent vault file still yields `{}`.
- `store/save.ts`: the per-env map is keyed by `v.id` (`envValuesById`) rather than `v.name`.
- `store/load.ts`: vault entries map straight into `model.values[id][env]`; the old name→id reconciliation is removed. Unknown ids (not in the manifest) are skipped.
- `io/discovery.ts` `scanRepo` populates `model.values` by id directly and returns `{ model }` (no separate `valuesByEnv`).
- `cli/init.ts`: drops its name→id value remapping; it scans, sets recipients, saves, and writes `.gitignore`.

### Generation is unchanged in spirit
Each app's real `.env` still emits `KEY=` using the variable **name** (`v.name`). `apps/api/.env` gets `NODE_ENV=development`; `apps/web/.env` gets `NODE_ENV=production`. Only the storage key changed; emitted keys remain the real names. Each conflicted local is wired only to its owner app (`consumers: [appId]`), so a single app's `.env` never contains duplicate keys.

---

## Decisions / edge cases

- **D1 — Examples don't drive sharing.** Sharing/conflict is decided only from real `.env` values. Example placeholders are attached afterward and never merge or split variables.
- **D2 — Example-only keys are local.** A key found only in a `.env.example` becomes a local variable owned by that app. It is never promoted to global automatically; the user can promote it later (future TUI work).
- **D3 — Conflict is all-or-nothing.** If a name has any cross-app value disagreement, *every* defining app gets its own local — menv does not group the agreeing apps into a global while splitting off outliers. This keeps a name from being simultaneously global and local and keeps behavior predictable.
- **D4 — Secret examples are emitted.** If a secret variable has an example value, it is written into `.env.example` (the example is a safe placeholder by definition). Secrets without an example emit `KEY=`.
- **D5 — Vault readability.** Decrypting a vault with the `age` CLI now yields JSON keyed by variable id rather than dotenv. This is acceptable: once keyed by id (required for per-app locals), the contents were no longer a usable `.env` regardless of format.

## Architecture / layering

Unchanged layering (`core` / `io` / `crypto` / `store` / `cli` / `ui`). The bulk of new logic is in `io/discovery.ts` (sharing + example import). The value-store re-keying is a small, mechanical change spread across `crypto/vault.ts`, `store/save.ts`, `store/load.ts`, and `cli/init.ts`.

## Testing strategy

- **discovery** — shared same-value → single global with the shared value; conflicting values → per-app locals with distinct ids and their own values; example values imported onto matching variables; example-only key → local var with example and no real value; example values absent from `model.values`.
- **persist** — `example` round-trips through the manifest.
- **vault** — JSON round-trip, including a colon-bearing id key; absent file → `{}`.
- **save/load** — round-trip preserves two same-named conflicted locals with different values through encrypt → decrypt.
- **generate** — `renderAppExample` emits example values (and `KEY=` when absent); `writeGeneratedFiles` writes no `.env.example` for an app with no real env file but does for one with a `.env`.
- **init** — end-to-end: no example for env-less apps; conflicting `.env` values produce per-app locals; existing `.env.example` seeds example values.

## Files touched

`src/core/types.ts`, `src/io/discovery.ts` (largest), `src/io/generate.ts`, `src/io/persist.ts`, `src/crypto/vault.ts`, `src/store/save.ts`, `src/store/load.ts`, `src/cli/init.ts` — each with its tests. Plus a touch-up to `docs/superpowers/specs/2026-05-30-menv-design.md` (vault is JSON-by-id; `.env.example` is conditional and example-valued).
