# Design: Automated releases & versioning for the Go menv

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Scope:** Release automation for the Go implementation only (`go/`). The Bun/TS
project at the repo root is unaffected.

## Problem

The Go rewrite of menv lives under `go/` and has no release process: no tags, no
changelog, no published binaries, and `go install` does not resolve. We want
automatic semantic versioning, a generated changelog, GitHub Releases, and
prebuilt binaries — driven by conventional commits, with as little manual work
as possible.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Release tooling | **release-please** (versioning, changelog, tag, GitHub Release) |
| Binary artifacts | **GoReleaser** cross-compiles and attaches binaries |
| Tag format | Plain `vX.Y.Z` (`include-component-in-tag: false`) |
| First version | `0.1.0` |
| `go install` support | Fix module path to `github.com/nikrabaev/menv/go` |
| General test/lint CI | Out of scope (may be added later) |

## Release flow

1. Conventional-commit work touching `go/**` merges to `main`
   (`feat(go): …`, `fix(go): …`, `feat(go)!:`/`BREAKING CHANGE:` for breaks).
2. The **release-please** action runs on every push to `main` and maintains a
   standing "release PR" that bumps the version and regenerates
   `go/CHANGELOG.md` from the commit log.
3. Merging that release PR makes release-please create the tag `vX.Y.Z` and a
   GitHub Release whose body is the changelog.
4. In the **same workflow run**, a second job — gated on release-please's
   `releases_created` output — checks out the new tag, runs **GoReleaser**, and
   uploads cross-compiled binaries + checksums to the Release.

Building in the same run (rather than a separate `on: push: tags` workflow)
avoids the gotcha where the default `GITHUB_TOKEN` cannot trigger a second
workflow. No PAT is required.

## Components

### `release-please-config.json` (repo root)

Manifest config with a single package rooted at `go`:

- `release-type: go`
- `include-component-in-tag: false` → plain `vX.Y.Z` tags
- `package-name: menv`
- changelog written to `go/CHANGELOG.md`
- optional `bootstrap-sha` set to the first Go commit to keep the first
  changelog from scanning unrelated history (decided during implementation).

### `.release-please-manifest.json` (repo root)

Seeded `{ "go": "0.0.0" }`. The Go code's `feat(go):` history bumps
`0.0.0 → 0.1.0`, so the first release is exactly **0.1.0**. A `Release-As: 0.1.0`
footer on the bootstrap commit pins this deterministically.

### `.github/workflows/release.yml`

- Trigger: `push` to `main`.
- Permissions: `contents: write`, `pull-requests: write`.
- Job 1 `release-please`: `googleapis/release-please-action@v4` with the
  manifest config; exposes `releases_created` and the path-prefixed
  `go--tag_name` output.
- Job 2 `goreleaser` (`needs: release-please`, `if: releases_created == 'true'`):
  checks out `go--tag_name`, `actions/setup-go`, then
  `goreleaser/goreleaser-action@v6` with `workdir: go` and
  `args: release --clean`. Uses the default `GITHUB_TOKEN`.

### `go/.goreleaser.yaml`

GoReleaser v2:

- build `./cmd/menv`, output binary `menv`
- targets: darwin/linux/windows × amd64/arm64
- ldflags `-s -w -X main.version={{.Version}}` — wires the tag into the existing
  `var version` in `go/cmd/menv/main.go` (set onto `program.Version`)
- archives: `tar.gz` (zip on Windows), checksums file
- `release.mode: keep-existing` so release-please owns the release notes and
  GoReleaser only attaches artifacts to the existing Release.

### Module-path fix

So `go install` resolves for a module in a subdirectory:

- `go/go.mod`: `module github.com/nikrabaev/menv` → `github.com/nikrabaev/menv/go`.
- Rewrite every self-import prefix `"github.com/nikrabaev/menv/` →
  `"github.com/nikrabaev/menv/go/` across all `.go` files (`cmd/`, `internal/`,
  `tests/`). Third-party imports do not share that prefix and are untouched.
- Verify: `go mod tidy && go build ./... && go vet ./... && go test ./...`.
- Result: `go install github.com/nikrabaev/menv/go/cmd/menv@latest` works.

### Docs

- New `go/README.md`: install (`go install …/go/cmd/menv@latest` or download a
  release binary), the conventional-commit requirement, and how to cut a release
  (merge the release PR).
- Root `README.md` / `CLAUDE.md` (Bun-focused) left as-is.

## Non-goals

- No general test/lint CI workflow (releases only; may be added later).
- No release happens until this lands on `main`; on a feature branch the
  workflow is inert.
- The root TS project keeps its own manual versioning. Plain `vX.Y.Z` tags are
  now effectively the Go release line's namespace.

## Verification

- `go build ./...`, `go vet ./...`, `go test ./...` pass after the module rename.
- `release-please-config.json` and `.release-please-manifest.json` are valid JSON
  matching the release-please manifest schema.
- `go/.goreleaser.yaml` passes `goreleaser check`.
- Workflow YAML is syntactically valid and references real action versions.
