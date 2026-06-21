package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/core/ops"
	"github.com/nikrabaev/menv/internal/registry"
	"github.com/nikrabaev/menv/internal/vault"
)

// MutationFlags bundles global flags every mutating command needs.
type MutationFlags struct {
	DryRun    bool
	Force     bool
	Mode      OutputMode
	VaultAuth map[string]string // vault name → secret (from --vault-auth flags)
}

// PromptFn asks the user for a vault passphrase interactively.
type PromptFn func(vaultName string) (string, error)

// osEnv returns the current environment as map[string]string.
func osEnv() map[string]string {
	m := make(map[string]string)
	for _, pair := range os.Environ() {
		idx := strings.IndexByte(pair, '=')
		if idx < 0 {
			m[pair] = ""
		} else {
			m[pair[:idx]] = pair[idx+1:]
		}
	}
	return m
}

// OpenVaultSession opens a session for a vault, resolving auth via the standard
// 4-step chain. If the provider raises AUTH_MISSING and a prompt function is
// available, it prompts once and retries.
func OpenVaultSession(root string, reg registry.Registry, vaultName string, auth MutationFlags, promptFn PromptFn) (core.VaultSession, error) {
	def, err := ops.RequireVault(reg, vaultName)
	if err != nil {
		return nil, err
	}
	p, err := vault.GetProvider(def.VaultType)
	if err != nil {
		return nil, err
	}

	// Resolve auth: flag overrides the optional chain.
	var resolved vault.VaultAuth
	if secret, flagSet := auth.VaultAuth[vaultName]; flagSet {
		resolved = vault.VaultAuth{Secret: secret, HasSecret: true}
	} else {
		resolved, err = vault.ResolveVaultAuthOptional(vaultName, root, osEnv())
		if err != nil {
			return nil, err
		}
	}

	sess, err := p.Init(def.VaultConfig, vault.VaultInitContext{Root: root, Auth: resolved})
	if err != nil {
		var me *core.MenvError
		if errors.As(err, &me) && me.Code == core.ErrAuthMissing && promptFn != nil {
			secret, pe := promptFn(vaultName)
			if pe != nil {
				return nil, pe
			}
			return p.Init(def.VaultConfig, vault.VaultInitContext{
				Root: root,
				Auth: vault.VaultAuth{Secret: secret, HasSecret: true},
			})
		}
		return nil, err
	}
	return sess, nil
}

// ValueScan is the result of opening vault sessions and scanning for values.
type ValueScan struct {
	Records    []core.ValueRecord
	Unverified []string // vault names that could not be opened
	Openable   map[string]bool
	Sessions   map[string]core.VaultSession
}

// CollectValueRecords opens each requested vault and reads every mapped value.
// Auth failures become "unverified" entries, not errors.
func CollectValueRecords(root string, reg registry.Registry, vaultNames []string, auth MutationFlags, promptFn PromptFn) (ValueScan, error) {
	seen := map[string]bool{}
	unique := make([]string, 0, len(vaultNames))
	for _, v := range vaultNames {
		if !seen[v] {
			seen[v] = true
			unique = append(unique, v)
		}
	}
	sort.Strings(unique)

	var records []core.ValueRecord
	var unverified []string
	sessions := map[string]core.VaultSession{}
	openable := map[string]bool{}

	for _, vaultName := range unique {
		sess, err := OpenVaultSession(root, reg, vaultName, auth, promptFn)
		if err != nil {
			var me *core.MenvError
			if errors.As(err, &me) && (me.Code == core.ErrAuthMissing || me.Code == core.ErrAuthFailed) {
				unverified = append(unverified, vaultName)
				continue
			}
			return ValueScan{}, err
		}
		sessions[vaultName] = sess
		openable[vaultName] = true

		for varName, def := range reg.Variables {
			byConsumer, ok := def.VaultMapping[vaultName]
			if !ok {
				continue
			}
			for consumerName, entry := range byConsumer {
				val, found, err := sess.Get(entry.Key)
				if err != nil {
					return ValueScan{}, err
				}
				if found {
					records = append(records, core.ValueRecord{
						Variable: varName,
						Vault:    vaultName,
						Consumer: consumerName,
						Raw:      val,
					})
				}
			}
		}
	}
	return ValueScan{Records: records, Unverified: unverified, Openable: openable, Sessions: sessions}, nil
}

// MutationExtras carries optional result fields and file op callbacks.
type MutationExtras struct {
	ResultFields map[string]any
	Pretty       string
	ApplyFileOp  func(core.FileOp) error
}

// RunMutation is the single path every mutating command takes.
// On dry-run: emits the plan and returns. Otherwise: opens missing vault sessions,
// executes the plan, saves the registry, and emits the result.
func RunMutation(
	root string,
	reg registry.Registry,
	op ops.OpResult,
	flags MutationFlags,
	io Io,
	sessions map[string]core.VaultSession,
	extras MutationExtras,
	promptFn PromptFn,
) error {
	if sessions == nil {
		sessions = map[string]core.VaultSession{}
	}
	defer func() {
		for _, s := range sessions {
			_ = s.Close()
		}
	}()

	plan := op.Plan
	if flags.DryRun {
		planJSON, _ := json.Marshal(plan)
		result := map[string]any{"dryRun": true, "plan": json.RawMessage(planJSON)}
		for k, v := range extras.ResultFields {
			result[k] = v
		}
		pretty := core.RenderPlanPretty(plan) + "\n(dry run — nothing applied)"
		if extras.Pretty != "" {
			pretty += "\n" + extras.Pretty
		}
		EmitResult(io, flags.Mode, result, pretty)
		return nil
	}

	// Open any vault sessions the plan needs but aren't already open.
	for _, vop := range plan.Vaults {
		if _, ok := sessions[vop.Vault]; ok {
			continue
		}
		sess, err := OpenVaultSession(root, reg, vop.Vault, flags, promptFn)
		if err != nil {
			return err
		}
		sessions[vop.Vault] = sess
	}

	err := core.ExecutePlan(plan, core.ExecuteContext{
		Force:    flags.Force,
		Sessions: sessions,
		CommitRegistry: func() error {
			return registry.SaveRegistry(root, op.Next)
		},
		ApplyFileOp: extras.ApplyFileOp,
	})
	if err != nil {
		return err
	}

	planJSON, _ := json.Marshal(plan)
	result := map[string]any{"applied": true, "plan": json.RawMessage(planJSON)}
	for k, v := range extras.ResultFields {
		result[k] = v
	}
	pretty := core.RenderPlanPretty(plan) + "\napplied"
	if extras.Pretty != "" {
		pretty += "\n" + extras.Pretty
	}
	EmitResult(io, flags.Mode, result, pretty)
	return nil
}

// ParseVaultAuth parses repeated --vault-auth <vault>=<secret> flags.
func ParseVaultAuth(pairs []string) (map[string]string, error) {
	out := map[string]string{}
	for _, pair := range pairs {
		idx := strings.IndexByte(pair, '=')
		if idx < 1 {
			return nil, &core.MenvError{
				Code:    core.ErrValidation,
				Message: fmt.Sprintf("--vault-auth expects <vault>=<secret>, got %q", pair),
			}
		}
		out[pair[:idx]] = pair[idx+1:]
	}
	return out, nil
}
