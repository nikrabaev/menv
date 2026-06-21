package tui

import (
	"fmt"

	"github.com/nikrabaev/menv/internal/cli"
	"github.com/nikrabaev/menv/internal/core"
	menvio "github.com/nikrabaev/menv/internal/io"
	"github.com/nikrabaev/menv/internal/registry"
	"github.com/nikrabaev/menv/internal/vault"
)

// TuiContext is the immutable session context for the TUI.
// Passphrases live only in Auth; they are never written to disk, logs, or state.
type TuiContext struct {
	Root string
	Env  map[string]string
	Auth map[string]string // vault name → secret (in-memory only)
}

// OpenSession opens a vault session using only what's in ctx.Auth (no TTY prompt).
func OpenSession(ctx *TuiContext, reg registry.Registry, vaultName string) (core.VaultSession, error) {
	def, ok := reg.Vaults[vaultName]
	if !ok {
		return nil, &core.MenvError{Code: core.ErrNotFound, Message: fmt.Sprintf("unknown vault %q", vaultName)}
	}
	p, err := vault.GetProvider(def.VaultType)
	if err != nil {
		return nil, err
	}
	auth := vault.VaultAuth{}
	if secret, ok := ctx.Auth[vaultName]; ok {
		auth = vault.VaultAuth{Secret: secret, HasSecret: true}
	} else {
		resolved, err := vault.ResolveVaultAuthOptional(vaultName, ctx.Root, ctx.Env)
		if err != nil {
			return nil, err
		}
		auth = resolved
	}
	return p.Init(def.VaultConfig, vault.VaultInitContext{Root: ctx.Root, Auth: auth})
}

// LoadVaultRuntime snapshots all values in a vault into VaultRuntime.
// If the vault can't be opened, returns an unlocked=false runtime (not an error).
func LoadVaultRuntime(ctx *TuiContext, reg registry.Registry, vaultName string) VaultRuntime {
	sess, err := OpenSession(ctx, reg, vaultName)
	if err != nil {
		return VaultRuntime{}
	}
	defer sess.Close()

	values := map[string]string{}
	// Collect all referenced keys.
	for _, vdef := range reg.Variables {
		byConsumer, ok := vdef.VaultMapping[vaultName]
		if !ok {
			continue
		}
		for _, entry := range byConsumer {
			if _, already := values[entry.Key]; already {
				continue
			}
			val, found, err := sess.Get(entry.Key)
			if err == nil && found {
				values[entry.Key] = val
			}
		}
	}
	return VaultRuntime{Unlocked: true, Values: values}
}

// LoadAllVaults loads runtime state for all vaults in the registry.
func LoadAllVaults(ctx *TuiContext, reg registry.Registry) map[string]VaultRuntime {
	result := map[string]VaultRuntime{}
	for name := range reg.Vaults {
		result[name] = LoadVaultRuntime(ctx, reg, name)
	}
	return result
}

// LoadFindings runs the check gate and returns findings.
func LoadFindings(ctx *TuiContext, reg registry.Registry) []cli.Finding {
	flags := cli.MutationFlags{}
	findings, _ := cli.CollectFindings(ctx.Root, reg, flags)
	return findings
}

// LoadBackups returns available backup keys.
func LoadBackups(ctx *TuiContext) []string {
	backups, _ := menvio.ListBackups(ctx.Root)
	return backups
}
