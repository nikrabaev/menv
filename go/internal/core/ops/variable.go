package ops

import (
	"fmt"
	"sort"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/registry"
)

// VarDefineInput holds the parameters for planVarDefine.
type VarDefineInput struct {
	Name        string
	GroupKey    string // empty = no group
	Secret      *bool  // nil = unset
	Description string
	Example     string
}

// PlanVarDefine creates a new variable definition in the registry.
func PlanVarDefine(r registry.Registry, input VarDefineInput) (OpResult, error) {
	if !NameRE.MatchString(input.Name) {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("invalid variable name %q (env-var style)", input.Name),
		}
	}
	if _, exists := r.Variables[input.Name]; exists {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("variable %q already exists — use `menv var update`", input.Name),
		}
	}
	if input.GroupKey != "" {
		if _, err := RequireGroup(r, input.GroupKey); err != nil {
			return OpResult{}, err
		}
	}

	next := CloneRegistry(r)
	def := registry.VariableDef{VaultMapping: map[string]map[string]registry.MappingEntry{}}
	if input.GroupKey != "" {
		def.GroupKey = input.GroupKey
	}
	if input.Secret != nil {
		def.Secret = *input.Secret
	}
	if input.Description != "" {
		def.Description = input.Description
	}
	if input.Example != "" {
		def.Example = input.Example
	}
	next.Variables[input.Name] = def

	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("variables.%s", input.Name),
		Summary: fmt.Sprintf("define variable %q", input.Name),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// VarUpdateInput holds the parameters for PlanVarUpdate.
type VarUpdateInput struct {
	Name        string
	GroupKey    string // empty = no change (unless ClearGroup)
	ClearGroup  bool
	Secret      *bool  // nil = no change
	Description *string // nil = no change
	Example     *string // nil = no change
}

// PlanVarUpdate modifies an existing variable's metadata.
func PlanVarUpdate(r registry.Registry, input VarUpdateInput) (OpResult, error) {
	if _, err := RequireVariable(r, input.Name); err != nil {
		return OpResult{}, err
	}
	if input.GroupKey != "" {
		if _, err := RequireGroup(r, input.GroupKey); err != nil {
			return OpResult{}, err
		}
	}

	next := CloneRegistry(r)
	def := next.Variables[input.Name]
	var changed []string

	if input.ClearGroup {
		def.GroupKey = ""
		changed = append(changed, "groupKey cleared")
	} else if input.GroupKey != "" {
		def.GroupKey = input.GroupKey
		changed = append(changed, "groupKey")
	}
	if input.Secret != nil {
		def.Secret = *input.Secret
		changed = append(changed, "secret")
	}
	if input.Description != nil {
		def.Description = *input.Description
		changed = append(changed, "description")
	}
	if input.Example != nil {
		def.Example = *input.Example
		changed = append(changed, "example")
	}
	next.Variables[input.Name] = def

	plan := NewPlan()
	if len(changed) > 0 {
		sort.Strings(changed)
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "set",
			Path:    fmt.Sprintf("variables.%s", input.Name),
			Summary: fmt.Sprintf("update variable %q (%s)", input.Name, joinComma(changed)),
		})
	}
	return OpResult{Next: next, Plan: plan}, nil
}

// VarRemoveInput holds the parameters for PlanVarRemove.
type VarRemoveInput struct {
	Name      string
	Records   []core.ValueRecord // collected from opened vaults
	Unverified []string           // vaults that could not be opened
	Openable  map[string]bool
}

// PlanVarRemove removes a variable and its vault keys.
func PlanVarRemove(r registry.Registry, input VarRemoveInput) (OpResult, error) {
	def, err := RequireVariable(r, input.Name)
	if err != nil {
		return OpResult{}, err
	}

	plan := NewPlan()

	// Block if any other variable's value references this one.
	filtered := make([]core.ValueRecord, 0, len(input.Records))
	for _, rec := range input.Records {
		if rec.Variable != input.Name {
			filtered = append(filtered, rec)
		}
	}
	dependents := core.FindDependents(input.Name, filtered)
	for _, d := range dependents {
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "DEPENDENT_REFERENCE",
			Message: fmt.Sprintf("%q references ${%s} (vault %q, consumer %q)", d.Variable, input.Name, d.Vault, d.Consumer),
		})
	}
	sorted := append([]string{}, input.Unverified...)
	sort.Strings(sorted)
	for _, v := range sorted {
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "UNVERIFIED_REFERENCES",
			Message: fmt.Sprintf("vault %q could not be opened — references to ${%s} there are unverified", v, input.Name),
		})
	}

	// Queue vault key removals for openable vaults.
	lockedWithOrphans := map[string]bool{}
	for vault, byConsumer := range def.VaultMapping {
		keySet := map[string]bool{}
		for _, entry := range byConsumer {
			keySet[entry.Key] = true
		}
		keys := make([]string, 0, len(keySet))
		for k := range keySet {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if input.Openable[vault] {
			for _, key := range keys {
				plan.Vaults = append(plan.Vaults, core.VaultOp{Vault: vault, Action: "remove", Key: key})
			}
		} else {
			lockedWithOrphans[vault] = true
		}
	}
	for vault := range lockedWithOrphans {
		plan.Warnings = append(plan.Warnings, core.PlanIssue{
			Code:    "ORPHANED_KEYS",
			Message: fmt.Sprintf("vault %q could not be opened — keys for %q remain (menv check will report them)", vault, input.Name),
		})
	}

	next := CloneRegistry(r)
	delete(next.Variables, input.Name)
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "remove",
		Path:    fmt.Sprintf("variables.%s", input.Name),
		Summary: fmt.Sprintf("remove variable %q", input.Name),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

func joinComma(parts []string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += ", "
		}
		result += p
	}
	return result
}
