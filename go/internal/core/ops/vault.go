package ops

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// VaultAddInput holds the parameters for PlanVaultAdd.
type VaultAddInput struct {
	Name        string
	VaultType   string
	VaultConfig map[string]any
}

// PlanVaultAdd adds a new vault definition to the registry.
func PlanVaultAdd(r registry.Registry, input VaultAddInput) (OpResult, error) {
	if err := RequireSlug("vault", input.Name); err != nil {
		return OpResult{}, err
	}
	if _, exists := r.Vaults[input.Name]; exists {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("vault %q already exists", input.Name),
		}
	}
	configBytes, _ := json.Marshal(input.VaultConfig)
	next := CloneRegistry(r)
	next.Vaults[input.Name] = registry.VaultDef{
		VaultType:   input.VaultType,
		VaultConfig: json.RawMessage(configBytes),
	}
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("vaults.%s", input.Name),
		Summary: fmt.Sprintf("add vault %q (%s)", input.Name, input.VaultType),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// VaultUpdateInput holds the parameters for PlanVaultUpdate.
type VaultUpdateInput struct {
	Name        string
	Config      map[string]any // merged into existing vaultConfig
	MakeDefault bool
}

// PlanVaultUpdate modifies an existing vault's config or makes it the default.
func PlanVaultUpdate(r registry.Registry, input VaultUpdateInput) (OpResult, error) {
	def, err := RequireVault(r, input.Name)
	if err != nil {
		return OpResult{}, err
	}
	next := CloneRegistry(r)
	plan := NewPlan()

	if len(input.Config) > 0 {
		// Merge new config over existing.
		base := map[string]any{}
		if def.VaultConfig != nil {
			_ = json.Unmarshal(def.VaultConfig, &base)
		}
		for k, v := range input.Config {
			base[k] = v
		}
		merged, _ := json.Marshal(base)
		vd := next.Vaults[input.Name]
		vd.VaultConfig = json.RawMessage(merged)
		next.Vaults[input.Name] = vd

		keys := make([]string, 0, len(input.Config))
		for k := range input.Config {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "set",
			Path:    fmt.Sprintf("vaults.%s.vaultConfig", input.Name),
			Summary: fmt.Sprintf("update vault %q config (%s)", input.Name, joinComma(keys)),
		})
	}
	if input.MakeDefault {
		next.Defaults.Vault = input.Name
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "set",
			Path:    "defaults.vault",
			Summary: fmt.Sprintf("make %q the default vault", input.Name),
		})
	}
	return OpResult{Next: next, Plan: plan}, nil
}

// PlanVaultRemove removes a vault, cascading to all variable/global mappings.
// The vault's backing store file is never touched.
func PlanVaultRemove(r registry.Registry, input struct{ Name string }) (OpResult, error) {
	if _, err := RequireVault(r, input.Name); err != nil {
		return OpResult{}, err
	}
	if r.Defaults.Vault == input.Name {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("%q is the default vault — set another default first (menv vault update <name> --default)", input.Name),
		}
	}

	next := CloneRegistry(r)
	plan := NewPlan()

	delete(next.Vaults, input.Name)
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "remove",
		Path:    fmt.Sprintf("vaults.%s", input.Name),
		Summary: fmt.Sprintf("remove vault %q", input.Name),
	})

	// Cascade: remove all vaultMapping[name] entries.
	varNames := make([]string, 0, len(next.Variables))
	for n := range next.Variables {
		varNames = append(varNames, n)
	}
	sort.Strings(varNames)
	for _, varName := range varNames {
		def := next.Variables[varName]
		if _, ok := def.VaultMapping[input.Name]; !ok {
			continue
		}
		delete(def.VaultMapping, input.Name)
		next.Variables[varName] = def
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "remove",
			Path:    fmt.Sprintf("variables.%s.vaultMapping.%s", varName, input.Name),
			Summary: fmt.Sprintf("unmap %q from vault %q", varName, input.Name),
		})
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "VAULT_IN_USE",
			Message: fmt.Sprintf("variable %q is mapped in vault %q", varName, input.Name),
		})
	}

	// Cascade: remove all globals.values[name] entries.
	globalNames := make([]string, 0, len(next.Globals))
	for n := range next.Globals {
		globalNames = append(globalNames, n)
	}
	sort.Strings(globalNames)
	for _, globalName := range globalNames {
		def := next.Globals[globalName]
		if _, ok := def.Values[input.Name]; !ok {
			continue
		}
		delete(def.Values, input.Name)
		next.Globals[globalName] = def
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "remove",
			Path:    fmt.Sprintf("globals.%s.values.%s", globalName, input.Name),
			Summary: fmt.Sprintf("drop global %q value for vault %q", globalName, input.Name),
		})
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "VAULT_IN_USE",
			Message: fmt.Sprintf("global %q is defined for vault %q", globalName, input.Name),
		})
	}

	return OpResult{Next: next, Plan: plan}, nil
}
