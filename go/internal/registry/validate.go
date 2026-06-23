package registry

import (
	"fmt"
	"regexp"
)

// ValidationIssue represents a single validation problem found in menv.json.
type ValidationIssue struct {
	Path    string
	Message string
}

func (v ValidationIssue) String() string {
	return v.Path + ": " + v.Message
}

// Env-var-legal names for variables and globals; lower-case slugs for the
// names users invent (vaults, consumers, groups).
var (
	nameRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	slugRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)
)

// ValidateRegistry performs structural and referential validation of a parsed
// Registry. It returns every issue found (not just the first).
func ValidateRegistry(r Registry) []ValidationIssue {
	var issues []ValidationIssue
	add := func(path, msg string) {
		issues = append(issues, ValidationIssue{Path: path, Message: msg})
	}

	if r.SchemaVersion != 2 {
		add("schemaVersion", "must be the number 2")
	}

	vaultNames := make(map[string]bool, len(r.Vaults))
	consumerNames := make(map[string]bool, len(r.Consumers))
	groupKeys := make(map[string]bool, len(r.Groups))

	for name := range r.Vaults {
		vaultNames[name] = true
	}
	for name := range r.Consumers {
		consumerNames[name] = true
	}
	for key := range r.Groups {
		groupKeys[key] = true
	}

	// defaults
	if r.Defaults.Vault == "" {
		add("defaults.vault", "must name a vault")
	} else if !vaultNames[r.Defaults.Vault] {
		add("defaults.vault", fmt.Sprintf("unknown vault %q", r.Defaults.Vault))
	}

	// vaults
	for name, def := range r.Vaults {
		if !slugRE.MatchString(name) {
			add(fmt.Sprintf("vaults.%s", name), "invalid vault name (use a-z 0-9 . _ -)")
		}
		if def.VaultType == "" {
			add(fmt.Sprintf("vaults.%s.vaultType", name), "must be a non-empty string")
		}
		if def.VaultConfig == nil {
			add(fmt.Sprintf("vaults.%s.vaultConfig", name), "is required")
		}
	}

	// consumers
	for name, def := range r.Consumers {
		if !slugRE.MatchString(name) {
			add(fmt.Sprintf("consumers.%s", name), "invalid consumer name (use a-z 0-9 . _ -)")
		}
		if def.StrategyConfig.BaseDir == "" {
			add(fmt.Sprintf("consumers.%s.strategyConfig.baseDir", name), "must be a string")
		}
		switch def.StrategyType {
		case "single":
			if def.StrategyConfig.Filename == "" {
				add(fmt.Sprintf("consumers.%s.strategyConfig.filename", name), "must be a string")
			}
		case "per-vault":
			if len(def.StrategyConfig.Filenames) == 0 {
				add(fmt.Sprintf("consumers.%s.strategyConfig.filenames", name), "must be an object of vault → filename")
			} else {
				for vault := range def.StrategyConfig.Filenames {
					if !vaultNames[vault] {
						add(fmt.Sprintf("consumers.%s.strategyConfig.filenames.%s", name, vault),
							fmt.Sprintf("unknown vault %q", vault))
					}
				}
			}
		default:
			add(fmt.Sprintf("consumers.%s.strategyType", name), `must be "single" or "per-vault"`)
		}
	}

	// groups
	for key, def := range r.Groups {
		if !slugRE.MatchString(key) {
			add(fmt.Sprintf("groups.%s", key), "invalid group key (use a-z 0-9 . _ -)")
		}
		if def.Title == "" {
			add(fmt.Sprintf("groups.%s.title", key), "must be a string")
		}
	}

	// globals
	for name, def := range r.Globals {
		if !nameRE.MatchString(name) {
			add(fmt.Sprintf("globals.%s", name), "invalid global name (env-var style)")
		}
		for vault, val := range def.Values {
			if !vaultNames[vault] {
				add(fmt.Sprintf("globals.%s.values.%s", name, vault),
					fmt.Sprintf("unknown vault %q", vault))
				continue
			}
			if val.Source != "runtime" && val.Source != "static" {
				add(fmt.Sprintf("globals.%s.values.%s.source", name, vault),
					`must be "runtime" or "static"`)
				continue
			}
			if val.Source == "static" && val.Value == "" {
				add(fmt.Sprintf("globals.%s.values.%s.value", name, vault),
					"static globals need a string value")
			}
		}
	}

	// variables
	for name, def := range r.Variables {
		if !nameRE.MatchString(name) {
			add(fmt.Sprintf("variables.%s", name), "invalid variable name (env-var style)")
		}
		if def.GroupKey != "" && !groupKeys[def.GroupKey] {
			add(fmt.Sprintf("variables.%s.groupKey", name),
				fmt.Sprintf("unknown group %q", def.GroupKey))
		}
		if def.VaultMapping == nil {
			add(fmt.Sprintf("variables.%s.vaultMapping", name), "must be an object (may be empty)")
			continue
		}
		for vault, byConsumer := range def.VaultMapping {
			if !vaultNames[vault] {
				add(fmt.Sprintf("variables.%s.vaultMapping.%s", name, vault),
					fmt.Sprintf("unknown vault %q", vault))
				continue
			}
			for consumer, entry := range byConsumer {
				if !consumerNames[consumer] {
					add(fmt.Sprintf("variables.%s.vaultMapping.%s.%s", name, vault, consumer),
						fmt.Sprintf("unknown consumer %q", consumer))
				}
				if entry.Key == "" {
					add(fmt.Sprintf("variables.%s.vaultMapping.%s.%s.key", name, vault, consumer),
						"must be a non-empty string")
				}
			}
		}
	}

	// compose
	// files is validated via JSON unmarshaling (array of strings); no additional
	// referential checks needed at this layer.

	return issues
}
