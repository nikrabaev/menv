package ops

import (
	"fmt"
	"sort"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/registry"
)

// WireInput holds the parameters for PlanWire.
type WireInput struct {
	Name          string
	Vault         string
	Consumers     []string
	Shared        bool
	Key           string   // non-empty = re-key consumers onto this existing key
	NewKey        func() string
	RemoveOrphans bool
	Openable      map[string]bool
}

// PlanWire maps a variable to a vault key for the given consumers.
func PlanWire(r registry.Registry, input WireInput) (OpResult, error) {
	if _, err := RequireVariable(r, input.Name); err != nil {
		return OpResult{}, err
	}
	if _, err := RequireVault(r, input.Vault); err != nil {
		return OpResult{}, err
	}
	for _, c := range input.Consumers {
		if _, err := RequireConsumer(r, c); err != nil {
			return OpResult{}, err
		}
	}
	if input.Shared && input.Key != "" {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: "--shared and --key are mutually exclusive",
		}
	}

	existing := map[string]registry.MappingEntry{}
	if m, ok := r.Variables[input.Name].VaultMapping[input.Vault]; ok {
		for k, v := range m {
			existing[k] = v
		}
	}

	rekeying := input.Key != ""
	var already []string
	for _, c := range input.Consumers {
		if _, ok := existing[c]; ok {
			already = append(already, c)
		}
	}
	if !rekeying && len(already) > 0 {
		sort.Strings(already)
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("%q is already wired to %s in vault %q (unwire first)", input.Name, joinComma(already), input.Vault),
		}
	}

	// Determine the shared key (if any).
	var sharedKey string
	if input.Key != "" {
		sharedKey = input.Key
	} else if input.Shared {
		sharedKey = input.NewKey()
	}

	next := CloneRegistry(r)
	def := next.Variables[input.Name]
	if def.VaultMapping == nil {
		def.VaultMapping = map[string]map[string]registry.MappingEntry{}
	}
	if def.VaultMapping[input.Vault] == nil {
		def.VaultMapping[input.Vault] = map[string]registry.MappingEntry{}
	}
	mapping := def.VaultMapping[input.Vault]

	plan := NewPlan()
	vacated := map[string]bool{}

	for _, c := range input.Consumers {
		key := sharedKey
		if key == "" {
			key = input.NewKey()
		}
		prev, hasPrev := mapping[c]
		if hasPrev {
			if prev.Key == key {
				continue // already on target key
			}
			vacated[prev.Key] = true
			entry := registry.MappingEntry{Key: key}
			if prev.Disabled {
				entry.Disabled = true
			}
			mapping[c] = entry
			plan.Registry = append(plan.Registry, core.RegistryOp{
				Action:  "set",
				Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s.key", input.Name, input.Vault, c),
				Summary: fmt.Sprintf("re-key %q → %q to share key (vault %q)", input.Name, c, input.Vault),
			})
		} else {
			mapping[c] = registry.MappingEntry{Key: key}
			plan.Registry = append(plan.Registry, core.RegistryOp{
				Action:  "set",
				Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s", input.Name, input.Vault, c),
				Summary: fmt.Sprintf("wire %q → %q (vault %q)", input.Name, c, input.Vault),
			})
		}
	}
	def.VaultMapping[input.Vault] = mapping
	next.Variables[input.Name] = def

	// Orphan handling for vacated keys.
	surviving := map[string]bool{}
	for _, e := range mapping {
		surviving[e.Key] = true
	}
	vacatedKeys := make([]string, 0, len(vacated))
	for k := range vacated {
		vacatedKeys = append(vacatedKeys, k)
	}
	sort.Strings(vacatedKeys)
	for _, key := range vacatedKeys {
		if surviving[key] {
			continue
		}
		collectOrphan(&plan, input.Vault, key, input.Name, input.RemoveOrphans, input.Openable)
	}

	return OpResult{Next: next, Plan: plan}, nil
}

// UnwireInput holds the parameters for PlanUnwire.
type UnwireInput struct {
	Name          string
	Vault         string
	Consumers     []string
	Records       []core.ValueRecord
	Unverified    []string
	Openable      map[string]bool
	RemoveOrphans bool
}

// PlanUnwire removes consumer mappings from a variable in a vault.
func PlanUnwire(r registry.Registry, input UnwireInput) (OpResult, error) {
	def, err := RequireVariable(r, input.Name)
	if err != nil {
		return OpResult{}, err
	}
	if _, err := RequireVault(r, input.Vault); err != nil {
		return OpResult{}, err
	}
	mapping := def.VaultMapping[input.Vault]
	var missing []string
	for _, c := range input.Consumers {
		if _, ok := mapping[c]; !ok {
			missing = append(missing, c)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("%q is not wired to %s in vault %q", input.Name, joinComma(missing), input.Vault),
		}
	}

	plan := NewPlan()
	consumerSet := map[string]bool{}
	for _, c := range input.Consumers {
		consumerSet[c] = true
	}

	// Dependency check within the affected (vault, consumers).
	affectedRecords := make([]core.ValueRecord, 0, len(input.Records))
	for _, rec := range input.Records {
		if rec.Vault == input.Vault && consumerSet[rec.Consumer] && rec.Variable != input.Name {
			affectedRecords = append(affectedRecords, rec)
		}
	}
	dependents := core.FindDependents(input.Name, affectedRecords)
	for _, d := range dependents {
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "DEPENDENT_REFERENCE",
			Message: fmt.Sprintf("%q references ${%s} (vault %q, consumer %q)", d.Variable, input.Name, d.Vault, d.Consumer),
		})
	}
	for _, v := range input.Unverified {
		if v == input.Vault {
			plan.Blockers = append(plan.Blockers, core.PlanIssue{
				Code:    "UNVERIFIED_REFERENCES",
				Message: fmt.Sprintf("vault %q could not be opened — references to ${%s} there are unverified", v, input.Name),
			})
		}
	}

	next := CloneRegistry(r)
	nextDef := next.Variables[input.Name]
	if nextDef.VaultMapping == nil {
		nextDef.VaultMapping = map[string]map[string]registry.MappingEntry{}
	}
	nextMapping := nextDef.VaultMapping[input.Vault]
	if nextMapping == nil {
		nextMapping = map[string]registry.MappingEntry{}
	}

	removedKeys := map[string]bool{}
	for _, c := range input.Consumers {
		if entry, ok := nextMapping[c]; ok {
			removedKeys[entry.Key] = true
		}
		delete(nextMapping, c)
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "remove",
			Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s", input.Name, input.Vault, c),
			Summary: fmt.Sprintf("unwire %q from %q (vault %q)", input.Name, c, input.Vault),
		})
	}

	surviving := map[string]bool{}
	for _, e := range nextMapping {
		surviving[e.Key] = true
	}
	removedKeyList := make([]string, 0, len(removedKeys))
	for k := range removedKeys {
		removedKeyList = append(removedKeyList, k)
	}
	sort.Strings(removedKeyList)
	for _, key := range removedKeyList {
		if surviving[key] {
			continue
		}
		collectOrphan(&plan, input.Vault, key, input.Name, input.RemoveOrphans, input.Openable)
	}

	if len(nextMapping) == 0 {
		delete(nextDef.VaultMapping, input.Vault)
	} else {
		nextDef.VaultMapping[input.Vault] = nextMapping
	}
	next.Variables[input.Name] = nextDef

	return OpResult{Next: next, Plan: plan}, nil
}

// SetDisabledInput holds the parameters for PlanSetDisabled.
type SetDisabledInput struct {
	Name     string
	Vault    string
	Consumer string
	Disabled bool
}

// PlanSetDisabled enables or disables a wired variable for a given consumer.
func PlanSetDisabled(r registry.Registry, input SetDisabledInput) (OpResult, error) {
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
	entry, ok := def.VaultMapping[input.Vault][input.Consumer]
	if !ok {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("%q is not wired to %q in vault %q", input.Name, input.Consumer, input.Vault),
		}
	}
	plan := NewPlan()
	if entry.Disabled == input.Disabled {
		plan.Warnings = append(plan.Warnings, core.PlanIssue{
			Code:    "NOOP",
			Message: fmt.Sprintf("%q is already %s for %q in vault %q", input.Name, disabledStr(input.Disabled), input.Consumer, input.Vault),
		})
		return OpResult{Next: r, Plan: plan}, nil
	}
	next := CloneRegistry(r)
	nextEntry := next.Variables[input.Name].VaultMapping[input.Vault][input.Consumer]
	nextEntry.Disabled = input.Disabled
	next.Variables[input.Name].VaultMapping[input.Vault][input.Consumer] = nextEntry
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s.disabled", input.Name, input.Vault, input.Consumer),
		Summary: fmt.Sprintf("%s %q for %q (vault %q)", disabledStr(input.Disabled), input.Name, input.Consumer, input.Vault),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

func disabledStr(d bool) string {
	if d {
		return "disable"
	}
	return "enable"
}

func collectOrphan(plan *core.Plan, vault, key, name string, removeOrphans bool, openable map[string]bool) {
	if !removeOrphans {
		plan.Warnings = append(plan.Warnings, core.PlanIssue{
			Code:    "ORPHANED_KEYS",
			Message: fmt.Sprintf("key %q for %q is now unused in vault %q — left in place (use --remove-orphans to drop it)", key, name, vault),
		})
		return
	}
	if openable[vault] {
		plan.Vaults = append(plan.Vaults, core.VaultOp{Vault: vault, Action: "remove", Key: key})
	} else {
		plan.Warnings = append(plan.Warnings, core.PlanIssue{
			Code:    "ORPHANED_KEYS",
			Message: fmt.Sprintf("vault %q could not be opened — orphaned key %q remains (menv check will report it)", vault, key),
		})
	}
}
