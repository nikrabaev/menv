// Package tui is a from-scratch terminal UI for menv built on the Charm v2
// stack: bubbletea (Elm architecture), lipgloss (layout/styling), bubbles
// (components) and huh (forms). It is a thin, stateful front-end over the
// pure domain in internal/core, internal/registry, internal/vault and
// internal/generate, reusing internal/cli's vault/check helpers so the TUI
// and CLI agree on behaviour.
package tui

import (
	"github.com/nikrabaev/menv/go/internal/cli"
)

// TuiContext carries the process-level handles the TUI needs. Auth holds
// per-vault secrets resolved at runtime (e.g. via the unlock modal); it lives
// only in memory and is never written to disk.
type TuiContext struct {
	Root string
	Env  map[string]string
	Auth map[string]string // vault name -> secret
}

// flags builds the cli.MutationFlags every reused cli helper expects, seeding
// VaultAuth from the in-memory unlock secrets.
func (c *TuiContext) flags() cli.MutationFlags {
	auth := make(map[string]string, len(c.Auth))
	for k, v := range c.Auth {
		auth[k] = v
	}
	return cli.MutationFlags{VaultAuth: auth, Mode: cli.ModePretty}
}

// authCopy returns a snapshot of the auth map safe to hand to a background Cmd.
func (c *TuiContext) authCopy() map[string]string {
	out := make(map[string]string, len(c.Auth))
	for k, v := range c.Auth {
		out[k] = v
	}
	return out
}
