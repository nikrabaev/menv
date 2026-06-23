package ops

import (
	"fmt"
	"sort"

	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// GlobalWriteInput holds the parameters for PlanGlobalDefine and PlanGlobalUpdate.
type GlobalWriteInput struct {
	Name        string
	Vault       string
	Source      string // "runtime" | "static"
	Value       string // required when Source == "static"
	Description string
}

func buildGlobalValueDef(input GlobalWriteInput) (registry.GlobalValueDef, error) {
	switch input.Source {
	case "static":
		if input.Value == "" {
			return registry.GlobalValueDef{}, &core.MenvError{
				Code:    core.ErrValidation,
				Message: "static global needs --value",
			}
		}
		return registry.GlobalValueDef{Source: "static", Value: input.Value}, nil
	case "runtime":
		return registry.GlobalValueDef{Source: "runtime"}, nil
	default:
		return registry.GlobalValueDef{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf(`source must be "runtime" or "static", got %q`, input.Source),
		}
	}
}

// PlanGlobalDefine creates a new global or adds a vault entry to an existing one.
func PlanGlobalDefine(r registry.Registry, input GlobalWriteInput) (OpResult, error) {
	if !NameRE.MatchString(input.Name) {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("invalid global name %q (env-var style)", input.Name),
		}
	}
	if _, err := RequireVault(r, input.Vault); err != nil {
		return OpResult{}, err
	}
	if def, exists := r.Globals[input.Name]; exists {
		if _, vaultExists := def.Values[input.Vault]; vaultExists {
			return OpResult{}, &core.MenvError{
				Code:    core.ErrValidation,
				Message: fmt.Sprintf("global %q is already defined for vault %q — use `menv global update`", input.Name, input.Vault),
			}
		}
	}
	valueDef, err := buildGlobalValueDef(input)
	if err != nil {
		return OpResult{}, err
	}
	next := CloneRegistry(r)
	if existing, exists := next.Globals[input.Name]; exists {
		existing.Values[input.Vault] = valueDef
		if input.Description != "" {
			existing.Description = input.Description
		}
		next.Globals[input.Name] = existing
	} else {
		g := registry.GlobalDef{
			Values: map[string]registry.GlobalValueDef{input.Vault: valueDef},
		}
		if input.Description != "" {
			g.Description = input.Description
		}
		next.Globals[input.Name] = g
	}
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("globals.%s.values.%s", input.Name, input.Vault),
		Summary: fmt.Sprintf("define global %q for vault %q (%s)", input.Name, input.Vault, input.Source),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// PlanGlobalUpdate changes an existing global's vault entry.
func PlanGlobalUpdate(r registry.Registry, input GlobalWriteInput) (OpResult, error) {
	if _, err := RequireVault(r, input.Vault); err != nil {
		return OpResult{}, err
	}
	def, exists := r.Globals[input.Name]
	if !exists || func() bool { _, ok := def.Values[input.Vault]; return !ok }() {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("global %q is not defined for vault %q — use `menv global define`", input.Name, input.Vault),
		}
	}
	valueDef, err := buildGlobalValueDef(input)
	if err != nil {
		return OpResult{}, err
	}
	next := CloneRegistry(r)
	g := next.Globals[input.Name]
	g.Values[input.Vault] = valueDef
	if input.Description != "" {
		g.Description = input.Description
	}
	next.Globals[input.Name] = g
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("globals.%s.values.%s", input.Name, input.Vault),
		Summary: fmt.Sprintf("update global %q for vault %q (%s)", input.Name, input.Vault, input.Source),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// GlobalRemoveInput holds the parameters for PlanGlobalRemove.
type GlobalRemoveInput struct {
	Name       string
	Vault      string // empty = remove from all vaults
	Records    []core.ValueRecord
	Unverified []string
}

// PlanGlobalRemove removes a global from one or all vaults.
func PlanGlobalRemove(r registry.Registry, input GlobalRemoveInput) (OpResult, error) {
	def, exists := r.Globals[input.Name]
	if !exists {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("unknown global %q", input.Name),
		}
	}
	if input.Vault != "" {
		if _, ok := def.Values[input.Vault]; !ok {
			return OpResult{}, &core.MenvError{
				Code:    core.ErrNotFound,
				Message: fmt.Sprintf("global %q is not defined for vault %q", input.Name, input.Vault),
			}
		}
	}

	var affected []string
	if input.Vault != "" {
		affected = []string{input.Vault}
	} else {
		for v := range def.Values {
			affected = append(affected, v)
		}
		sort.Strings(affected)
	}
	affectedSet := map[string]bool{}
	for _, v := range affected {
		affectedSet[v] = true
	}

	plan := NewPlan()
	// A wired variable with the same name shadows this global; don't block on those refs.
	filtered := make([]core.ValueRecord, 0, len(input.Records))
	for _, rec := range input.Records {
		if !affectedSet[rec.Vault] {
			continue
		}
		// Shadowing check: if a variable with this name is wired to this (vault, consumer), skip.
		varDef, exists := r.Variables[input.Name]
		if exists {
			if _, wired := varDef.VaultMapping[rec.Vault][rec.Consumer]; wired {
				continue
			}
		}
		filtered = append(filtered, rec)
	}
	dependents := core.FindDependents(input.Name, filtered)
	for _, d := range dependents {
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "DEPENDENT_REFERENCE",
			Message: fmt.Sprintf("%q references ${%s} (vault %q, consumer %q)", d.Variable, input.Name, d.Vault, d.Consumer),
		})
	}
	unverifiedAffected := make([]string, 0)
	for _, v := range input.Unverified {
		if affectedSet[v] {
			unverifiedAffected = append(unverifiedAffected, v)
		}
	}
	sort.Strings(unverifiedAffected)
	for _, v := range unverifiedAffected {
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "UNVERIFIED_REFERENCES",
			Message: fmt.Sprintf("vault %q could not be opened — references to ${%s} there are unverified", v, input.Name),
		})
	}

	next := CloneRegistry(r)
	target := next.Globals[input.Name]
	for _, v := range affected {
		delete(target.Values, v)
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "remove",
			Path:    fmt.Sprintf("globals.%s.values.%s", input.Name, v),
			Summary: fmt.Sprintf("remove global %q from vault %q", input.Name, v),
		})
	}
	if len(target.Values) == 0 {
		delete(next.Globals, input.Name)
	} else {
		next.Globals[input.Name] = target
	}
	return OpResult{Next: next, Plan: plan}, nil
}
