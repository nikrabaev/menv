package generate

import (
	"os"
	"path/filepath"
	"sort"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/registry"
)

// GenerateOpts selects which consumers/vaults to generate for.
type GenerateOpts struct {
	Vault    string // empty = registry default
	Consumer string // empty = all consumers
}

// FileWrite is one file to be written.
type FileWrite struct {
	Path    string
	Content string
}

// GeneratePreview is the result of a preview pass.
type GeneratePreview struct {
	Writes   []FileWrite
	Unchanged []string
	Refused  []string         // files without the ownership marker that would be overwritten
	Warnings []core.PlanIssue
}

// GlobalsFor builds the globals map for a given vault.
func GlobalsFor(reg registry.Registry, vaultName string) map[string]core.GlobalResolution {
	out := map[string]core.GlobalResolution{}
	for name, def := range reg.Globals {
		v, ok := def.Values[vaultName]
		if !ok {
			continue
		}
		if v.Source == "static" {
			out[name] = core.GlobalResolution{Kind: "static", Value: v.Value}
		} else {
			out[name] = core.GlobalResolution{Kind: "runtime"}
		}
	}
	return out
}

// VaultsNeeded returns the distinct vault names required for a generate pass.
func VaultsNeeded(reg registry.Registry, opts GenerateOpts) []string {
	seen := map[string]bool{}
	for _, t := range EnvTargets(reg.Consumers, reg.Defaults, opts) {
		seen[t.Vault] = true
	}
	vaults := make([]string, 0, len(seen))
	for v := range seen {
		vaults = append(vaults, v)
	}
	sort.Strings(vaults)
	return vaults
}

// ScopeEntries fetches and expands all variable values for one (consumer, vault).
func ScopeEntries(
	reg registry.Registry,
	consumer, vaultName string,
	sess core.VaultSession,
	warnings *[]core.PlanIssue,
) ([]RenderEntry, error) {
	rawVals := map[string]string{}
	type meta struct {
		name     string
		disabled bool
	}
	var metas []meta
	for name, def := range reg.Variables {
		entry, ok := def.VaultMapping[vaultName][consumer]
		if !ok {
			continue
		}
		val, _, err := sess.Get(entry.Key)
		if err != nil {
			return nil, err
		}
		if val == "" {
			*warnings = append(*warnings, core.PlanIssue{
				Code:    "MISSING_VALUE",
				Message: `"` + name + `" has no value in vault "` + vaultName + `" (consumer "` + consumer + `") — rendered empty`,
			})
		}
		rawVals[name] = val
		metas = append(metas, meta{name: name, disabled: entry.Disabled})
	}
	globals := GlobalsFor(reg, vaultName)
	expanded, err := core.ExpandAll(core.ExpandInput{Values: rawVals, Globals: globals})
	if err != nil {
		return nil, err
	}
	entries := make([]RenderEntry, len(metas))
	for i, m := range metas {
		def := reg.Variables[m.name]
		entries[i] = RenderEntry{
			Name:     m.name,
			Value:    expanded[m.name],
			Disabled: m.disabled,
			Secret:   def.Secret,
			GroupKey: def.GroupKey,
			Example:  def.Example,
		}
	}
	return entries, nil
}

// readFile is a helper that reads a file; returns os.ErrNotExist if absent.
func readFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func classifyWrite(root, relPath, content string, preview *GeneratePreview) error {
	abs := filepath.Join(root, relPath)
	existing, err := os.ReadFile(abs)
	if os.IsNotExist(err) {
		preview.Writes = append(preview.Writes, FileWrite{Path: relPath, Content: content})
		return nil
	}
	if err != nil {
		return err
	}
	if string(existing) == content {
		preview.Unchanged = append(preview.Unchanged, relPath)
		return nil
	}
	if !HasOwnershipMarker(string(existing)) {
		preview.Refused = append(preview.Refused, relPath)
		return nil
	}
	preview.Writes = append(preview.Writes, FileWrite{Path: relPath, Content: content})
	return nil
}

// PreviewGenerate computes every file a generate would write without actually
// writing anything. Reads vault sessions for values; reads disk to classify
// unchanged/refused.
func PreviewGenerate(
	root string,
	reg registry.Registry,
	opts GenerateOpts,
	sessions map[string]core.VaultSession,
) (GeneratePreview, error) {
	preview := GeneratePreview{}
	exampleDone := map[string]bool{}

	for _, target := range EnvTargets(reg.Consumers, reg.Defaults, opts) {
		sess, ok := sessions[target.Vault]
		if !ok {
			continue // CLI opens all VaultsNeeded; defensive skip
		}
		entries, err := ScopeEntries(reg, target.Consumer, target.Vault, sess, &preview.Warnings)
		if err != nil {
			return GeneratePreview{}, err
		}
		def := reg.Consumers[target.Consumer]
		header := DisclaimerHeader(HeaderMeta{Vault: target.Vault, Consumer: target.Consumer})
		main, local := SplitSecrets(entries, target.SecretsSplit)

		if err := classifyWrite(root, target.RelPath, RenderEnvContent(main, reg.Groups, header), &preview); err != nil {
			return GeneratePreview{}, err
		}
		if target.SecretsSplit {
			if err := classifyWrite(root, target.RelPath+".local", RenderEnvContent(local, reg.Groups, header), &preview); err != nil {
				return GeneratePreview{}, err
			}
		}
		if def.StrategyConfig.Example && !exampleDone[target.Consumer] {
			exampleDone[target.Consumer] = true
			// Union of all variable names wired to this consumer across any vault.
			names := map[string]bool{}
			for name, v := range reg.Variables {
				for _, byConsumer := range v.VaultMapping {
					if _, ok := byConsumer[target.Consumer]; ok {
						names[name] = true
					}
				}
			}
			exampleEntries := make([]RenderEntry, 0, len(names))
			for name := range names {
				v := reg.Variables[name]
				exampleEntries = append(exampleEntries, RenderEntry{
					Name:     name,
					Disabled: false,
					Secret:   v.Secret,
					GroupKey: v.GroupKey,
					Example:  v.Example,
				})
			}
			examplePath := filepath.Join(def.StrategyConfig.BaseDir, ".env.example")
			exampleHeader := DisclaimerHeader(HeaderMeta{Consumer: target.Consumer})
			content := RenderExampleContent(exampleEntries, reg.Groups, exampleHeader)
			if err := classifyWrite(root, examplePath, content, &preview); err != nil {
				return GeneratePreview{}, err
			}
		}
	}
	return preview, nil
}
