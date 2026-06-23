package ops

import (
	"fmt"
	"regexp"

	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// DotenvEntry is a key=value pair parsed from a .env file.
// Defined here to keep the ops package independent of the io package.
type DotenvEntry struct {
	Key   string
	Value string
}

// ImportReport summarises what happened during PlanImportEntries.
type ImportReport struct {
	Defined []string
	Wired   []string
	Updated []string
	Skipped []struct {
		Key    string
		Reason string
	}
}

// ImportInput holds the parameters for PlanImportEntries.
type ImportInput struct {
	Entries       []DotenvEntry
	Consumer      string
	Vault         string
	CurrentValues map[string]string // vault key → current value
	Force         bool
	NewKey        func() string
}

var secretHintRE = regexp.MustCompile(`(SECRET|TOKEN|PASSWORD|PASS|KEY|DSN|PRIVATE)`)

// PlanImportEntries ingests a set of dotenv entries: defining, wiring, and
// setting values in one atomic plan. Matches the TS planImportEntries exactly.
func PlanImportEntries(r registry.Registry, input ImportInput) (OpResult, ImportReport, error) {
	if _, err := RequireConsumer(r, input.Consumer); err != nil {
		return OpResult{}, ImportReport{}, err
	}
	if _, err := RequireVault(r, input.Vault); err != nil {
		return OpResult{}, ImportReport{}, err
	}

	next := CloneRegistry(r)
	plan := NewPlan()
	report := ImportReport{}

	for _, entry := range input.Entries {
		if !NameRE.MatchString(entry.Key) {
			report.Skipped = append(report.Skipped, struct {
				Key    string
				Reason string
			}{entry.Key, "invalid variable name"})
			continue
		}

		def, exists := next.Variables[entry.Key]
		if !exists {
			def = registry.VariableDef{
				VaultMapping: map[string]map[string]registry.MappingEntry{},
			}
			if secretHintRE.MatchString(entry.Key) {
				def.Secret = true
			}
			next.Variables[entry.Key] = def
			plan.Registry = append(plan.Registry, core.RegistryOp{
				Action:  "set",
				Path:    fmt.Sprintf("variables.%s", entry.Key),
				Summary: fmt.Sprintf("define variable %q", entry.Key),
			})
			report.Defined = append(report.Defined, entry.Key)
		}

		if def.VaultMapping == nil {
			def.VaultMapping = map[string]map[string]registry.MappingEntry{}
		}
		if def.VaultMapping[input.Vault] == nil {
			def.VaultMapping[input.Vault] = map[string]registry.MappingEntry{}
		}
		mapping := def.VaultMapping[input.Vault]

		mappingEntry, alreadyWired := mapping[input.Consumer]
		if !alreadyWired {
			key := input.NewKey()
			mapping[input.Consumer] = registry.MappingEntry{Key: key}
			def.VaultMapping[input.Vault] = mapping
			next.Variables[entry.Key] = def
			plan.Registry = append(plan.Registry, core.RegistryOp{
				Action:  "set",
				Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s", entry.Key, input.Vault, input.Consumer),
				Summary: fmt.Sprintf("wire %q → %q (vault %q)", entry.Key, input.Consumer, input.Vault),
			})
			plan.Vaults = append(plan.Vaults, core.VaultOp{
				Vault:  input.Vault,
				Action: "set",
				Key:    key,
				Value:  entry.Value,
			})
			report.Wired = append(report.Wired, entry.Key)
			continue
		}

		// Already wired — check for shared-key conflict.
		var sharedWith []string
		for c, e := range mapping {
			if c != input.Consumer && e.Key == mappingEntry.Key {
				sharedWith = append(sharedWith, c)
			}
		}
		currentValue := input.CurrentValues[mappingEntry.Key]
		if len(sharedWith) > 0 && currentValue != "" && currentValue != entry.Value {
			// Split onto a private key.
			key := input.NewKey()
			newEntry := mappingEntry
			newEntry.Key = key
			mapping[input.Consumer] = newEntry
			def.VaultMapping[input.Vault] = mapping
			next.Variables[entry.Key] = def
			plan.Registry = append(plan.Registry, core.RegistryOp{
				Action:  "set",
				Path:    fmt.Sprintf("variables.%s.vaultMapping.%s.%s", entry.Key, input.Vault, input.Consumer),
				Summary: fmt.Sprintf("split %q onto its own key for %q (vault %q)", entry.Key, input.Consumer, input.Vault),
			})
			plan.Vaults = append(plan.Vaults, core.VaultOp{
				Vault:  input.Vault,
				Action: "set",
				Key:    key,
				Value:  entry.Value,
			})
			plan.Blockers = append(plan.Blockers, core.PlanIssue{
				Code:    "SHARED_KEY_CONFLICT",
				Message: fmt.Sprintf("%q: incoming value differs from the value shared with %s (vault %q) — forcing splits %q onto its own key", entry.Key, joinComma(sharedWith), input.Vault, input.Consumer),
			})
			report.Updated = append(report.Updated, entry.Key)
			continue
		}

		// Update value on existing key.
		plan.Vaults = append(plan.Vaults, core.VaultOp{
			Vault:  input.Vault,
			Action: "set",
			Key:    mappingEntry.Key,
			Value:  entry.Value,
		})
		report.Updated = append(report.Updated, entry.Key)
	}

	return OpResult{Next: next, Plan: plan}, report, nil
}
