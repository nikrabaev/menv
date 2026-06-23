package generate

import (
	"path/filepath"
	"sort"

	"github.com/nikrabaev/menv/go/internal/registry"
)

// ConsumerPaths lists every path a consumer's config implies.
type ConsumerPaths struct {
	Main    []string
	Local   []string // non-empty only with SecretsAsLocalOverrides
	Example string   // non-empty only with Example=true
}

// ConsumerPaths returns all filesystem paths implied by a consumer definition.
func ConsumerPathsFor(def registry.ConsumerDef) ConsumerPaths {
	base := def.StrategyConfig.BaseDir
	var files []string
	if def.StrategyType == "single" {
		files = []string{def.StrategyConfig.Filename}
	} else {
		// per-vault: sort for determinism
		vaults := make([]string, 0, len(def.StrategyConfig.Filenames))
		for v := range def.StrategyConfig.Filenames {
			vaults = append(vaults, v)
		}
		sort.Strings(vaults)
		for _, v := range vaults {
			files = append(files, def.StrategyConfig.Filenames[v])
		}
	}
	main := make([]string, len(files))
	for i, f := range files {
		main[i] = filepath.Join(base, f)
	}
	var local []string
	if def.StrategyConfig.SecretsAsLocalOverrides {
		local = make([]string, len(main))
		for i, p := range main {
			local[i] = p + ".local"
		}
	}
	var example string
	if def.StrategyConfig.Example {
		example = filepath.Join(base, ".env.example")
	}
	return ConsumerPaths{Main: main, Local: local, Example: example}
}

// EnvTarget is one file that generate will write.
type EnvTarget struct {
	Consumer     string
	Vault        string
	RelPath      string
	SecretsSplit bool
}

// EnvTargets returns every (consumer, vault, file) triple that a generate
// with the given options would produce.
func EnvTargets(consumers map[string]registry.ConsumerDef, defaults registry.Defaults, opts GenerateOpts) []EnvTarget {
	var out []EnvTarget
	// stable order: sort consumer names
	names := make([]string, 0, len(consumers))
	for n := range consumers {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		if opts.Consumer != "" && name != opts.Consumer {
			continue
		}
		def := consumers[name]
		base := def.StrategyConfig.BaseDir
		split := def.StrategyConfig.SecretsAsLocalOverrides
		if def.StrategyType == "single" {
			out = append(out, EnvTarget{
				Consumer:     name,
				Vault:        coalesce(opts.Vault, defaults.Vault),
				RelPath:      filepath.Join(base, def.StrategyConfig.Filename),
				SecretsSplit: split,
			})
		} else {
			vaults := make([]string, 0, len(def.StrategyConfig.Filenames))
			for v := range def.StrategyConfig.Filenames {
				vaults = append(vaults, v)
			}
			sort.Strings(vaults)
			for _, v := range vaults {
				if opts.Vault != "" && v != opts.Vault {
					continue
				}
				out = append(out, EnvTarget{
					Consumer:     name,
					Vault:        v,
					RelPath:      filepath.Join(base, def.StrategyConfig.Filenames[v]),
					SecretsSplit: split,
				})
			}
		}
	}
	return out
}

func coalesce(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
