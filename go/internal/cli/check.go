package cli

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/generate"
	"github.com/nikrabaev/menv/go/internal/registry"
	"github.com/nikrabaev/menv/go/internal/vault"
)

// Finding is one item in the check report.
type Finding struct {
	Severity string `json:"severity"` // "error" | "warning"
	Code     string `json:"code"`
	Message  string `json:"message"`
}

func errFinding(code, msg string) Finding  { return Finding{"error", code, msg} }
func warnFinding(code, msg string) Finding { return Finding{"warning", code, msg} }

// gitTracked returns the set of tracked files in a git repo, or nil if git is
// unavailable.
func gitTracked(root string) map[string]bool {
	out, err := exec.Command("git", "-C", root, "ls-files", "-z").Output()
	if err != nil {
		return nil
	}
	tracked := map[string]bool{}
	for _, f := range strings.Split(string(out), "\x00") {
		if f != "" {
			tracked[f] = true
		}
	}
	return tracked
}

// CollectFindings performs all repo health checks and returns the findings.
// Never returns an error from auth failures — those become UNVERIFIED_VAULT warnings.
func CollectFindings(root string, reg registry.Registry, auth MutationFlags) ([]Finding, error) {
	var findings []Finding
	sessions := map[string]core.VaultSession{}
	defer func() {
		for _, s := range sessions {
			_ = s.Close()
		}
	}()

	// Open all vaults; auth failures → warning.
	for vaultName, def := range reg.Vaults {
		var resolved vault.VaultAuth
		if secret, ok := auth.VaultAuth[vaultName]; ok {
			resolved = vault.VaultAuth{Secret: secret, HasSecret: true}
		} else {
			var err error
			resolved, err = vault.ResolveVaultAuthOptional(vaultName, root, osEnv())
			if err != nil {
				var me *core.MenvError
				if errors.As(err, &me) && (me.Code == core.ErrAuthMissing || me.Code == core.ErrAuthFailed) {
					findings = append(findings, warnFinding("UNVERIFIED_VAULT", `vault "`+vaultName+`" could not be opened — checks against it skipped`))
					continue
				}
				return nil, err
			}
		}
		p, err := vault.GetProvider(def.VaultType)
		if err != nil {
			return nil, err
		}
		sess, err := p.Init(def.VaultConfig, vault.VaultInitContext{Root: root, Auth: resolved})
		if err != nil {
			var me *core.MenvError
			if errors.As(err, &me) && (me.Code == core.ErrAuthMissing || me.Code == core.ErrAuthFailed) {
				findings = append(findings, warnFinding("UNVERIFIED_VAULT", `vault "`+vaultName+`" could not be opened — checks against it skipped`))
				continue
			}
			return nil, err
		}
		sessions[vaultName] = sess
	}

	// Interpolation + missing values per (consumer, vault) scope.
	interpolationFailed := map[string]bool{}
	for _, target := range generate.EnvTargets(reg.Consumers, reg.Defaults, generate.GenerateOpts{}) {
		sess, ok := sessions[target.Vault]
		if !ok {
			continue
		}
		var warnings []core.PlanIssue
		_, err := generate.ScopeEntries(reg, target.Consumer, target.Vault, sess, &warnings)
		if err != nil {
			var me *core.MenvError
			if errors.As(err, &me) {
				findings = append(findings, errFinding("INTERPOLATION", target.Consumer+"/"+target.Vault+": "+me.Message))
				interpolationFailed[target.Consumer+"|"+target.Vault] = true
			} else {
				return nil, err
			}
		}
		for _, w := range warnings {
			findings = append(findings, warnFinding(w.Code, w.Message))
		}
	}

	// Staleness / foreign files.
	previewCache := map[string]generate.GeneratePreview{}
	for consumerName, def := range reg.Consumers {
		paths := generate.ConsumerPathsFor(def)
		var allPaths []string
		allPaths = append(allPaths, paths.Main...)
		allPaths = append(allPaths, paths.Local...)
		if paths.Example != "" {
			allPaths = append(allPaths, paths.Example)
		}
		for _, rel := range allPaths {
			abs := filepath.Join(root, rel)
			data, err := readFileOpt(abs)
			if err != nil || data == nil {
				continue
			}
			content := string(data)
			if !generate.HasOwnershipMarker(content) {
				findings = append(findings, errFinding("FOREIGN_FILE", rel+" exists but is not menv-managed (no marker)"))
				continue
			}
			vaultName := generate.HeaderVault(content)
			if vaultName == "" {
				vaultName = reg.Defaults.Vault
			}
			if rel == paths.Example {
				// Example is vault-independent; find any available vault.
				for _, t := range generate.EnvTargets(reg.Consumers, reg.Defaults, generate.GenerateOpts{Consumer: consumerName}) {
					if _, ok := sessions[t.Vault]; ok {
						vaultName = t.Vault
						break
					}
				}
			}
			cacheKey := consumerName + "|" + vaultName
			preview, ok := previewCache[cacheKey]
			if !ok {
				if interpolationFailed[cacheKey] {
					continue
				}
				p, err := generate.PreviewGenerate(root, reg, generate.GenerateOpts{Consumer: consumerName, Vault: vaultName}, sessions)
				if err != nil {
					var me *core.MenvError
					if errors.As(err, &me) {
						if !interpolationFailed[cacheKey] {
							findings = append(findings, errFinding("INTERPOLATION", consumerName+"/"+vaultName+": "+me.Message))
							interpolationFailed[cacheKey] = true
						}
						continue
					}
					return nil, err
				}
				previewCache[cacheKey] = p
				preview = p
			}
			for _, w := range preview.Writes {
				if w.Path == rel {
					findings = append(findings, errFinding("STALE", rel+" differs from what generate would write"))
				}
			}
		}
	}

	// Compose marker checks.
	for _, cfile := range reg.Compose.Files {
		abs := filepath.Join(root, cfile)
		data, err := readFileOpt(abs)
		if err != nil || data == nil {
			findings = append(findings, errFinding("MISSING_COMPOSE_FILE", "registered compose file not found: "+cfile))
			continue
		}
		regions, errs := generate.FindMarkerRegions(string(data))
		for _, e := range errs {
			findings = append(findings, errFinding("COMPOSE_MARKER", cfile+": "+e))
		}
		if len(regions) == 0 {
			findings = append(findings, warnFinding("COMPOSE_NO_MARKERS", cfile+": bound but has no menv markers"))
		}
		for _, r := range regions {
			if _, ok := reg.Consumers[r.Consumer]; !ok {
				findings = append(findings, errFinding("COMPOSE_UNKNOWN_CONSUMER", cfile+`: marker names unknown consumer "`+r.Consumer+`"`))
			}
		}
	}

	// Git tracking violations.
	tracked := gitTracked(root)
	if tracked == nil {
		findings = append(findings, warnFinding("GIT_UNAVAILABLE", "git not available — tracking checks skipped"))
	} else {
		for vaultName, def := range reg.Vaults {
			var cfg struct {
				Filename   string `json:"filename"`
				Encryption bool   `json:"encryption"`
			}
			if err := unmarshalJSON(def.VaultConfig, &cfg); err != nil {
				continue
			}
			if def.VaultType == "menv-local" && !cfg.Encryption && cfg.Filename != "" && tracked[cfg.Filename] {
				findings = append(findings, errFinding("PLAINTEXT_VAULT_TRACKED",
					`plaintext vault "`+vaultName+`" file `+cfg.Filename+` is tracked by git`))
			}
		}
		for consumerName, def := range reg.Consumers {
			hasSecret := false
			for _, vdef := range reg.Variables {
				if !vdef.Secret {
					continue
				}
				for _, byConsumer := range vdef.VaultMapping {
					if _, ok := byConsumer[consumerName]; ok {
						hasSecret = true
						break
					}
				}
				if hasSecret {
					break
				}
			}
			if !hasSecret {
				continue
			}
			paths := generate.ConsumerPathsFor(def)
			split := def.StrategyConfig.SecretsAsLocalOverrides
			var risky []string
			if split {
				risky = paths.Local
			} else {
				risky = paths.Main
			}
			for _, p := range risky {
				if tracked[p] {
					findings = append(findings, errFinding("SECRET_FILE_TRACKED",
						p+" may contain secret values and is tracked by git"))
				}
			}
		}
		seen := map[string]bool{}
		for _, cfile := range reg.Compose.Files {
			dir := filepath.Dir(cfile)
			var envCompose string
			if dir == "." {
				envCompose = ".env.compose"
			} else {
				envCompose = filepath.Join(dir, ".env.compose")
			}
			if seen[envCompose] {
				continue
			}
			seen[envCompose] = true
			if tracked[envCompose] {
				findings = append(findings, errFinding("SECRET_FILE_TRACKED",
					envCompose+" may contain secret values and is tracked by git"))
			}
		}
	}

	// Orphaned vault keys.
	for vaultName, sess := range sessions {
		referenced := map[string]bool{}
		for _, vdef := range reg.Variables {
			for _, entry := range vdef.VaultMapping[vaultName] {
				referenced[entry.Key] = true
			}
		}
		keys, err := sess.List()
		if err != nil {
			continue
		}
		for _, k := range keys {
			if !referenced[k] {
				findings = append(findings, warnFinding("ORPHANED_KEY", `vault "`+vaultName+`" key "`+k+`" is referenced by no variable`))
			}
		}
	}

	return findings, nil
}

// RunCheck is the CLI gate: exits 1 if any finding is an error.
func RunCheck(root string, reg registry.Registry, flags MutationFlags, io Io) error {
	findings, err := CollectFindings(root, reg, flags)
	if err != nil {
		return err
	}
	var errCount int
	for _, f := range findings {
		if f.Severity == "error" {
			errCount++
		}
	}
	var lines []string
	for _, f := range findings {
		sym := "⚠"
		if f.Severity == "error" {
			sym = "✖"
		}
		lines = append(lines, sym+" "+f.Code+": "+f.Message)
	}
	pretty := "all checks passed"
	if len(lines) > 0 {
		pretty = strings.Join(lines, "\n")
	}
	if errCount > 0 {
		if flags.Mode == ModePretty {
			io.Stdout(pretty + "\n")
		}
		return &core.MenvError{
			Code:    core.ErrValidation,
			Message: formatCheckError(errCount),
			Details: findings,
		}
	}
	EmitResult(io, flags.Mode, map[string]any{"findings": findings}, pretty)
	return nil
}

func formatCheckError(n int) string {
	return fmt.Sprintf("check found %d error(s)", n)
}

func readFileOpt(abs string) ([]byte, error) {
	data, err := readFileSafe(abs)
	if err != nil {
		return nil, nil
	}
	return data, nil
}
