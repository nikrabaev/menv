# Go Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Go menv (`go/`) automatic semantic versioning, a generated changelog, GitHub Releases, and prebuilt cross-platform binaries — driven by conventional commits.

**Architecture:** `release-please` (manifest mode, one package at path `go`) maintains a release PR and, on merge, cuts the `vX.Y.Z` tag + GitHub Release with changelog. In the same workflow run, a job gated on `releases_created` checks out the tag and runs GoReleaser (`workdir: go`) to attach binaries + checksums to that Release. Separately, the Go module path is corrected so `go install` resolves.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action@v4`, `goreleaser/goreleaser-action@v6` (GoReleaser v2), Go 1.25+ (toolchain go1.26.4 at `/usr/local/go/bin/go`).

**Conventions for this plan:**
- Repo root is `/Users/nikrabaev/Work/personal/menv`. All paths below are relative to it unless absolute.
- Run `go` via the module-dir flag to avoid `cd`: `go -C go <cmd>` (e.g. `go -C go test ./...`). If `go` is not on PATH, use `/usr/local/go/bin/go`.
- `sed` is BSD/macOS → in-place edits use `sed -i ''`.
- Commit freely on this branch; never commit a plaintext secret. Do not push.

---

### Task 1: Fix the Go module path so `go install` resolves

The module lives in `go/` but declares `module github.com/nikrabaev/menv`, which is inconsistent with its location. Rename it to `github.com/nikrabaev/menv/go` and rewrite every self-import. The existing Go test suite is the safety net.

**Files:**
- Modify: `go/go.mod:1`
- Modify (mechanical): every `*.go` under `go/` that imports `github.com/nikrabaev/menv/...` (cmd/, internal/, tests/)

- [ ] **Step 1: Confirm the current state (baseline build + test pass)**

Run:
```bash
go -C go build ./... && go -C go test ./... 2>&1 | tail -20
```
Expected: builds cleanly; all tests PASS. (Establishes the green baseline before the rename.)

- [ ] **Step 2: Rename the module path in `go.mod`**

Edit `go/go.mod` line 1:

```
module github.com/nikrabaev/menv
```
→
```
module github.com/nikrabaev/menv/go
```

- [ ] **Step 3: Rewrite all self-import prefixes**

This rewrites only quoted imports that begin with the old module path + `/` (subpath imports). Third-party imports do not share the `github.com/nikrabaev/menv/` prefix, so they are untouched. Run exactly once (re-running would produce `.../go/go/`):

```bash
grep -rl '"github.com/nikrabaev/menv/' --include='*.go' /Users/nikrabaev/Work/personal/menv/go \
  | xargs sed -i '' 's#"github.com/nikrabaev/menv/#"github.com/nikrabaev/menv/go/#g'
```

- [ ] **Step 4: Verify no stale references to the old path remain**

Run:
```bash
grep -rn '"github.com/nikrabaev/menv/internal' --include='*.go' /Users/nikrabaev/Work/personal/menv/go; \
grep -rn '"github.com/nikrabaev/menv"' --include='*.go' /Users/nikrabaev/Work/personal/menv/go; \
echo "exit: done"
```
Expected: NO matches for either grep (both should print nothing before `exit: done`). If the bare-path grep matches, hand-fix those imports to `github.com/nikrabaev/menv/go`.

- [ ] **Step 5: Tidy modules**

Run:
```bash
go -C go mod tidy
```
Expected: succeeds; `go.sum` unchanged or only formatting (the rename does not alter dependencies).

- [ ] **Step 6: Verify build, vet, and the full suite still pass**

Run:
```bash
go -C go build ./... && go -C go vet ./... && go -C go test ./... 2>&1 | tail -20
```
Expected: build OK, vet OK, all tests PASS — identical result to Step 1, now under the new module path.

- [ ] **Step 7: Commit**

```bash
git add go/go.mod go/go.sum go/cmd go/internal go/tests
git commit -m "refactor(go): move module path to github.com/nikrabaev/menv/go

Aligns the module path with its go/ subdirectory location so
'go install github.com/nikrabaev/menv/go/cmd/menv@latest' resolves."
```

---

### Task 2: Add release-please configuration

Manifest-mode config with a single package at path `go`, plain `vX.Y.Z` tags, changelog at `go/CHANGELOG.md`, seeded to bootstrap at 0.1.0.

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

- [ ] **Step 1: Create `release-please-config.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "include-component-in-tag": false,
  "packages": {
    "go": {
      "release-type": "go",
      "package-name": "menv",
      "changelog-path": "CHANGELOG.md"
    }
  }
}
```

(`include-component-in-tag: false` → tags are `vX.Y.Z` with no `menv-` prefix. `changelog-path` is relative to the package path, so the changelog lands at `go/CHANGELOG.md`. release-please only considers commits touching `go/**` for this package.)

- [ ] **Step 2: Create `.release-please-manifest.json`**

```json
{
  "go": "0.0.0"
}
```

(`0.0.0` means "nothing released yet." The first `feat(go):` commit that reaches `main` bumps `0.0.0 → 0.1.0`. See the README note in Task 5 on pinning the first release exactly if the branch is squash-merged.)

- [ ] **Step 3: Validate both files are well-formed JSON**

Run:
```bash
jq -e . release-please-config.json >/dev/null && echo "config OK"; \
jq -e . .release-please-manifest.json >/dev/null && echo "manifest OK"
```
Expected: `config OK` and `manifest OK`.

- [ ] **Step 4: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci(go): add release-please manifest config (plain v tags, start 0.1.0)"
```

---

### Task 3: Add GoReleaser configuration

GoReleaser v2 config inside `go/`. Cross-compiles `./cmd/menv`, injects the tag into `main.version`, builds archives + checksums, and only attaches artifacts to the release release-please already created (`mode: keep-existing`).

**Files:**
- Create: `go/.goreleaser.yaml`

- [ ] **Step 1: Create `go/.goreleaser.yaml`**

```yaml
version: 2

project_name: menv

before:
  hooks:
    - go mod tidy

builds:
  - id: menv
    main: ./cmd/menv
    binary: menv
    env:
      - CGO_ENABLED=0
    flags:
      - -trimpath
    ldflags:
      - -s -w -X main.version={{ .Version }}
    goos:
      - linux
      - darwin
      - windows
    goarch:
      - amd64
      - arm64

archives:
  - id: menv
    formats:
      - tar.gz
    name_template: "{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}"
    format_overrides:
      - goos: windows
        formats:
          - zip

checksum:
  name_template: checksums.txt

release:
  mode: keep-existing

changelog:
  disable: true
```

(`-X main.version={{ .Version }}` targets `var version` in `go/cmd/menv/main.go`, which is assigned to `program.Version`. `CGO_ENABLED=0` yields static binaries — all deps, including `filippo.io/age` and the charm libraries, are pure Go. `release.mode: keep-existing` leaves the release-please changelog as the release body and only uploads artifacts. `changelog.disable: true` because release-please owns the changelog.)

- [ ] **Step 2: Validate the GoReleaser config**

Run (uses `goreleaser` if installed, otherwise a YAML well-formedness check, otherwise defers to CI):
```bash
if command -v goreleaser >/dev/null; then \
  goreleaser check -f go/.goreleaser.yaml; \
elif python3 -c 'import yaml' 2>/dev/null; then \
  python3 -c 'import yaml; yaml.safe_load(open("go/.goreleaser.yaml")); print("YAML OK")'; \
else \
  echo "no local validator — CI will validate on first release"; \
fi
```
Expected: `goreleaser check` passes, or `YAML OK`, or the deferral message.

- [ ] **Step 3: Commit**

```bash
git add go/.goreleaser.yaml
git commit -m "ci(go): add GoReleaser config for cross-platform release binaries"
```

---

### Task 4: Add the release GitHub Actions workflow

One workflow on push to `main`: job 1 runs release-please; job 2 (gated on `releases_created`) checks out the new tag and runs GoReleaser. Same-run hand-off avoids the `GITHUB_TOKEN`-can't-trigger-a-workflow gotcha.

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      releases_created: ${{ steps.release.outputs.releases_created }}
      tag_name: ${{ steps.release.outputs['go--tag_name'] }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  goreleaser:
    needs: release-please
    if: ${{ needs.release-please.outputs.releases_created == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}
          fetch-depth: 0
      - uses: actions/setup-go@v5
        with:
          go-version-file: go/go.mod
          cache-dependency-path: go/go.sum
      - uses: goreleaser/goreleaser-action@v6
        with:
          version: '~> v2'
          args: release --clean
          workdir: go
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

(`releases_created` is release-please-action's aggregate output; `go--tag_name` is the per-path output for the package at path `go` — keys with `--` require bracket syntax. `fetch-depth: 0` gives GoReleaser full history/tags. `workdir: go` runs GoReleaser inside the module so `./cmd/menv` and `.goreleaser.yaml` resolve.)

- [ ] **Step 2: Validate the workflow YAML**

Run (prefers `actionlint`, falls back to a YAML parse, then defers to GitHub):
```bash
if command -v actionlint >/dev/null; then \
  actionlint .github/workflows/release.yml; \
elif python3 -c 'import yaml' 2>/dev/null; then \
  python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/release.yml")); print("YAML OK")'; \
else \
  echo "no local validator — GitHub validates on push"; \
fi
```
Expected: `actionlint` passes, or `YAML OK`, or the deferral message.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(go): add release workflow (release-please + GoReleaser)"
```

---

### Task 5: Document releases (`go/README.md`)

A short README for the Go implementation: install paths, the conventional-commit requirement, and how to cut a release (including how the first 0.1.0 is produced).

**Files:**
- Create: `go/README.md`

- [ ] **Step 1: Create `go/README.md`**

````markdown
# menv (Go)

The Go implementation of menv. For the full CLI grammar and concepts, see the
[root README](../README.md).

## Install

```bash
# latest tagged release, built from source:
go install github.com/nikrabaev/menv/go/cmd/menv@latest
```

Or download a prebuilt binary (macOS, Linux, Windows — amd64/arm64) from the
[Releases page](https://github.com/nikrabaev/menv/releases). Each release ships
`tar.gz`/`zip` archives plus a `checksums.txt`.

## Build from source

```bash
go -C go build -o menv ./cmd/menv
./go/menv --version
```

## Releases

Releases are automated with
[release-please](https://github.com/googleapis/release-please) and
[GoReleaser](https://goreleaser.com), wired up in
`.github/workflows/release.yml`.

**Versioning is driven by [Conventional Commits](https://www.conventionalcommits.org)**
on commits that touch `go/**`:

- `fix(go): …` → patch bump
- `feat(go): …` → minor bump
- `feat(go)!: …` or a `BREAKING CHANGE:` footer → major bump (pre-1.0: minor)

### Cutting a release

1. Land conventional-commit work on `main`.
2. release-please opens/updates a **release PR** that bumps the version and
   regenerates `go/CHANGELOG.md`.
3. Merge the release PR. release-please tags `vX.Y.Z` and creates the GitHub
   Release; GoReleaser then attaches the prebuilt binaries and checksums.

### First release (0.1.0)

`.release-please-manifest.json` starts at `0.0.0`, so the first `feat(go):`
commit reaching `main` produces `0.1.0`. If the Go branch is **squash-merged**
into `main`, make sure the squash commit message is a `feat(go):` (or include a
`Release-As: 0.1.0` footer) so release-please opens the first release PR.
````

- [ ] **Step 2: Commit**

```bash
git add go/README.md
git commit -m "docs(go): document install and the automated release process"
```

---

### Task 6: Final verification & spec coverage

- [ ] **Step 1: Re-run the Go suite (nothing regressed)**

Run:
```bash
go -C go build ./... && go -C go test ./... 2>&1 | tail -10
```
Expected: build OK, all tests PASS.

- [ ] **Step 2: Confirm all release files exist and parse**

Run:
```bash
jq -e . release-please-config.json >/dev/null && echo "config OK"; \
jq -e . .release-please-manifest.json >/dev/null && echo "manifest OK"; \
test -f go/.goreleaser.yaml && echo "goreleaser OK"; \
test -f .github/workflows/release.yml && echo "workflow OK"; \
test -f go/README.md && echo "readme OK"
```
Expected: five `OK` lines.

- [ ] **Step 3: Spec coverage check (manual)**

Confirm each design decision is implemented:
- release-please versioning/changelog/tag/release → Task 2 + Task 4
- GoReleaser binaries → Task 3 + Task 4
- plain `vX.Y.Z` tags → `include-component-in-tag: false` (Task 2)
- first version 0.1.0 → manifest `0.0.0` + README note (Task 2, Task 5)
- module path fix for `go install` → Task 1
- docs → Task 5
- no general test/lint CI → intentionally absent

- [ ] **Step 4: Review the full diff**

Run:
```bash
git log --oneline main..HEAD; echo "---"; git diff --stat main..HEAD
```
Expected: five new commits (refactor/ci/ci/ci/docs) plus the earlier design commit; diffstat shows the renamed module imports and the new release files.

---

## Notes on what happens after this lands

- This branch must merge to `main` before anything releases; on a feature branch the workflow is inert.
- On the first push to `main` with qualifying commits, release-please opens a release PR. Merging it produces tag `v0.1.0`, the GitHub Release, and the GoReleaser binaries.
- No secrets are required beyond the default `GITHUB_TOKEN`.
