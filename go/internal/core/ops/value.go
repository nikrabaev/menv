package ops

import (
	"fmt"
	"sort"
	"strings"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/registry"
)

// KeyQuery locates a mapping entry for get/set operations.
type KeyQuery struct {
	Name     string
	Vault    string
	Consumer string // optional; required only when consumers hold different keys
}

// ResolveMappingKey returns the vault key and the consumers that hold it.
// --consumer is only needed when consumers hold different keys; a single shared
// key is unambiguous. Ambiguity is an error, never a guess.
func ResolveMappingKey(r registry.Registry, q KeyQuery) (key string, consumers []string, err error) {
	def, err := RequireVariable(r, q.Name)
	if err != nil {
		return "", nil, err
	}
	if _, err := RequireVault(r, q.Vault); err != nil {
		return "", nil, err
	}
	mapping := def.VaultMapping[q.Vault]
	if len(mapping) == 0 {
		return "", nil, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("%q is not wired to any consumer in vault %q", q.Name, q.Vault),
		}
	}
	if q.Consumer != "" {
		entry, ok := mapping[q.Consumer]
		if !ok {
			return "", nil, &core.MenvError{
				Code:    core.ErrNotFound,
				Message: fmt.Sprintf("%q is not wired to %q in vault %q", q.Name, q.Consumer, q.Vault),
			}
		}
		return entry.Key, []string{q.Consumer}, nil
	}

	byKey := map[string][]string{}
	for consumer, entry := range mapping {
		byKey[entry.Key] = append(byKey[entry.Key], consumer)
	}
	if len(byKey) == 1 {
		for k, cs := range byKey {
			sort.Strings(cs)
			return k, cs, nil
		}
	}
	// Ambiguous — list options.
	var options []string
	for _, cs := range byKey {
		sort.Strings(cs)
		options = append(options, strings.Join(cs, "/"))
	}
	sort.Strings(options)
	return "", nil, &core.MenvError{
		Code:    core.ErrAmbiguous,
		Message: fmt.Sprintf("%q holds different values per consumer in vault %q — pass --consumer (one of: %s)", q.Name, q.Vault, strings.Join(options, ", ")),
	}
}

// SetValueInput holds the parameters for PlanSetValue.
type SetValueInput struct {
	KeyQuery
	Value string
}

// PlanSetValue writes a value to the vault key shared by all (or a specific) consumers.
// The registry is untouched; `next` IS the input registry.
func PlanSetValue(r registry.Registry, input SetValueInput) (OpResult, error) {
	key, _, err := ResolveMappingKey(r, input.KeyQuery)
	if err != nil {
		return OpResult{}, err
	}
	plan := NewPlan()
	plan.Vaults = append(plan.Vaults, core.VaultOp{
		Vault:  input.Vault,
		Action: "set",
		Key:    key,
		Value:  input.Value,
	})
	return OpResult{Next: r, Plan: plan}, nil
}

// SetUniqueValueInput holds the parameters for PlanSetUniqueValue.
type SetUniqueValueInput struct {
	Name     string
	Vault    string
	Consumer string
	Value    string
	NewKey   func() string
}

// PlanSetUniqueValue gives ONE consumer its own value. If the consumer currently
// shares a key, it is re-keyed onto a fresh private key first.
func PlanSetUniqueValue(r registry.Registry, input SetUniqueValueInput) (OpResult, error) {
	def, err := RequireVariable(r, input.Name)
	if err != nil {
		return OpResult{}, err
	}
	if _, err := RequireVault(r, input.Vault); err != nil {
		return OpResult{}, err
	}
	if _, err := RequireConsumer(r, input.Consumer); err != nil {
		return OpResult{}, err
	}
	mapping := def.VaultMapping[input.Vault]
	entry, ok := mapping[input.Consumer]
	if !ok {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("%q is not wired to %q in vault %q", input.Name, input.Consumer, input.Vault),
		}
	}

	// Check whether any other consumer shares this key.
	shared := false
	for c, e := range mapping {
		if c != input.Consumer && e.Key == entry.Key {
			shared = true
			break
		}
	}

	plan := NewPlan()
	key := entry.Key
	next := r
	if shared {
		next = CloneRegistry(r)
		key = input.NewKey()
		nextEntry := next.Variables[input.Name].VaultMapping[input.Vault][input.Consumer]
		nextEntry.Key = key
		next.Variables[input.Name].VaultMapping[input.Vault][input.Consumer] = nextEntry
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "set",
			Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s.key", input.Name, input.Vault, input.Consumer),
			Summary: fmt.Sprintf("isolate %q for %q onto a private key (vault %q)", input.Name, input.Consumer, input.Vault),
		})
	}
	plan.Vaults = append(plan.Vaults, core.VaultOp{
		Vault:  input.Vault,
		Action: "set",
		Key:    key,
		Value:  input.Value,
	})
	return OpResult{Next: next, Plan: plan}, nil
}
