package ops

import (
	"fmt"
	"sort"

	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// ConsumerAddInput holds the parameters for PlanConsumerAdd.
type ConsumerAddInput struct {
	Name                    string
	StrategyType            string // "single" | "per-vault"
	BaseDir                 string
	Filename                string            // single strategy
	Filenames               map[string]string // per-vault strategy
	SecretsAsLocalOverrides bool
	Example                 bool
}

func buildConsumerDef(r registry.Registry, input ConsumerAddInput) (registry.ConsumerDef, error) {
	cfg := registry.StrategyConfig{
		BaseDir: input.BaseDir,
	}
	if input.SecretsAsLocalOverrides {
		cfg.SecretsAsLocalOverrides = true
	}
	if input.Example {
		cfg.Example = true
	}
	switch input.StrategyType {
	case "single":
		if input.Filename == "" {
			return registry.ConsumerDef{}, &core.MenvError{
				Code:    core.ErrValidation,
				Message: "single strategy needs --filename",
			}
		}
		cfg.Filename = input.Filename
	case "per-vault":
		if len(input.Filenames) == 0 {
			return registry.ConsumerDef{}, &core.MenvError{
				Code:    core.ErrValidation,
				Message: "per-vault strategy needs --filenames <vault>=<file>,…",
			}
		}
		for vault := range input.Filenames {
			if _, err := RequireVault(r, vault); err != nil {
				return registry.ConsumerDef{}, err
			}
		}
		cfg.Filenames = input.Filenames
	default:
		return registry.ConsumerDef{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("unknown strategy type %q (use single or per-vault)", input.StrategyType),
		}
	}
	return registry.ConsumerDef{StrategyType: input.StrategyType, StrategyConfig: cfg}, nil
}

// PlanConsumerAdd registers a new consumer.
func PlanConsumerAdd(r registry.Registry, input ConsumerAddInput) (OpResult, error) {
	if err := RequireSlug("consumer", input.Name); err != nil {
		return OpResult{}, err
	}
	if _, exists := r.Consumers[input.Name]; exists {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("consumer %q already exists", input.Name),
		}
	}
	def, err := buildConsumerDef(r, input)
	if err != nil {
		return OpResult{}, err
	}
	next := CloneRegistry(r)
	next.Consumers[input.Name] = def
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("consumers.%s", input.Name),
		Summary: fmt.Sprintf("add consumer %q (%s, %s)", input.Name, input.StrategyType, input.BaseDir),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// ConsumerUpdateInput holds the parameters for PlanConsumerUpdate.
type ConsumerUpdateInput struct {
	Name                    string
	BaseDir                 *string           // nil = no change
	Filename                *string           // nil = no change (single only)
	Filenames               map[string]string // nil = no change (per-vault only)
	SecretsAsLocalOverrides *bool             // nil = no change
	Example                 *bool             // nil = no change
}

// PlanConsumerUpdate modifies an existing consumer's configuration.
func PlanConsumerUpdate(r registry.Registry, input ConsumerUpdateInput) (OpResult, error) {
	def, err := RequireConsumer(r, input.Name)
	if err != nil {
		return OpResult{}, err
	}
	if def.StrategyType == "per-vault" && input.Filename != nil {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("%q is per-vault — use --filenames, not --filename", input.Name),
		}
	}
	if def.StrategyType == "single" && len(input.Filenames) > 0 {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("%q is single — use --filename, not --filenames", input.Name),
		}
	}
	if len(input.Filenames) > 0 {
		for vault := range input.Filenames {
			if _, err := RequireVault(r, vault); err != nil {
				return OpResult{}, err
			}
		}
	}

	next := CloneRegistry(r)
	target := next.Consumers[input.Name]
	var changed []string

	if input.BaseDir != nil {
		target.StrategyConfig.BaseDir = *input.BaseDir
		changed = append(changed, "baseDir")
	}
	if target.StrategyType == "single" && input.Filename != nil {
		target.StrategyConfig.Filename = *input.Filename
		changed = append(changed, "filename")
	}
	if target.StrategyType == "per-vault" && len(input.Filenames) > 0 {
		if target.StrategyConfig.Filenames == nil {
			target.StrategyConfig.Filenames = map[string]string{}
		}
		for k, v := range input.Filenames {
			target.StrategyConfig.Filenames[k] = v
		}
		changed = append(changed, "filenames")
	}
	if input.SecretsAsLocalOverrides != nil {
		target.StrategyConfig.SecretsAsLocalOverrides = *input.SecretsAsLocalOverrides
		changed = append(changed, "secretsAsLocalOverrides")
	}
	if input.Example != nil {
		target.StrategyConfig.Example = *input.Example
		changed = append(changed, "example")
	}
	next.Consumers[input.Name] = target

	plan := NewPlan()
	if len(changed) > 0 {
		sort.Strings(changed)
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "set",
			Path:    fmt.Sprintf("consumers.%s", input.Name),
			Summary: fmt.Sprintf("update consumer %q (%s)", input.Name, joinComma(changed)),
		})
	}
	return OpResult{Next: next, Plan: plan}, nil
}

// ConsumerRemoveInput holds the parameters for PlanConsumerRemove.
type ConsumerRemoveInput struct {
	Name        string
	Openable    map[string]bool
	Paths       []string // generated file paths (optional; present in CLI layer)
	DeleteFiles bool
}

// PlanConsumerRemove removes a consumer and cascades to all variable wirings.
func PlanConsumerRemove(r registry.Registry, input ConsumerRemoveInput) (OpResult, error) {
	if _, err := RequireConsumer(r, input.Name); err != nil {
		return OpResult{}, err
	}
	next := CloneRegistry(r)
	plan := NewPlan()

	delete(next.Consumers, input.Name)
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "remove",
		Path:    fmt.Sprintf("consumers.%s", input.Name),
		Summary: fmt.Sprintf("remove consumer %q", input.Name),
	})

	lockedWithOrphans := map[string]bool{}
	varNames := make([]string, 0, len(next.Variables))
	for n := range next.Variables {
		varNames = append(varNames, n)
	}
	sort.Strings(varNames)

	for _, varName := range varNames {
		def := next.Variables[varName]
		vaultList := make([]string, 0, len(def.VaultMapping))
		for v := range def.VaultMapping {
			vaultList = append(vaultList, v)
		}
		sort.Strings(vaultList)
		for _, vault := range vaultList {
			byConsumer := def.VaultMapping[vault]
			entry, exists := byConsumer[input.Name]
			if !exists {
				continue
			}
			delete(byConsumer, input.Name)
			plan.Registry = append(plan.Registry, core.RegistryOp{
				Action:  "remove",
				Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s", varName, vault, input.Name),
				Summary: fmt.Sprintf("unwire %q from %q (vault %q)", varName, input.Name, vault),
			})
			// If no other consumer shares this key, it's orphaned.
			stillUsed := false
			for _, e := range byConsumer {
				if e.Key == entry.Key {
					stillUsed = true
					break
				}
			}
			if !stillUsed {
				if input.Openable[vault] {
					plan.Vaults = append(plan.Vaults, core.VaultOp{Vault: vault, Action: "remove", Key: entry.Key})
				} else {
					lockedWithOrphans[vault] = true
				}
			}
			if len(byConsumer) == 0 {
				delete(def.VaultMapping, vault)
			}
		}
		next.Variables[varName] = def
	}

	lockedList := make([]string, 0, len(lockedWithOrphans))
	for v := range lockedWithOrphans {
		lockedList = append(lockedList, v)
	}
	sort.Strings(lockedList)
	for _, vault := range lockedList {
		plan.Warnings = append(plan.Warnings, core.PlanIssue{
			Code:    "ORPHANED_KEYS",
			Message: fmt.Sprintf("vault %q could not be opened — keys orphaned by removing %q remain (menv check will report them)", vault, input.Name),
		})
	}

	for _, path := range input.Paths {
		action := "release"
		if input.DeleteFiles {
			action = "delete"
		}
		plan.Files = append(plan.Files, core.FileOp{Action: action, Path: path})
	}

	return OpResult{Next: next, Plan: plan}, nil
}
