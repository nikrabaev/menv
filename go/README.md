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
