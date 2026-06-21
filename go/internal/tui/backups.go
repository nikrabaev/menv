package tui

import (
	"encoding/json"
	"path/filepath"
	"sort"
	"time"

	"github.com/nikrabaev/menv/go/internal/generate"
	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// makeBackup mirrors the CLI's backup: snapshot menv.json, menv-local vault
// files, and every menv-owned generated file (plus .env.compose siblings).
func makeBackup(root string, reg registry.Registry) (string, []string, error) {
	key := menvio.BackupKey(time.Now())

	var vaultFiles []string
	for _, def := range reg.Vaults {
		if def.VaultType != "menv-local" {
			continue
		}
		var cfg struct {
			Filename string `json:"filename"`
		}
		if json.Unmarshal(def.VaultConfig, &cfg) == nil && cfg.Filename != "" {
			vaultFiles = append(vaultFiles, cfg.Filename)
		}
	}
	sort.Strings(vaultFiles)

	candidates := map[string]bool{}
	for _, def := range reg.Consumers {
		cp := generate.ConsumerPathsFor(def)
		for _, p := range cp.Main {
			candidates[p] = true
		}
		for _, p := range cp.Local {
			candidates[p] = true
		}
		if cp.Example != "" {
			candidates[cp.Example] = true
		}
	}
	seenDirs := map[string]bool{}
	for _, cfile := range reg.Compose.Files {
		dir := filepath.Dir(cfile)
		if dir == "." {
			dir = ""
		}
		if seenDirs[dir] {
			continue
		}
		seenDirs[dir] = true
		envCompose := ".env.compose"
		if dir != "" {
			envCompose = filepath.Join(dir, ".env.compose")
		}
		candidates[envCompose] = true
	}
	candList := make([]string, 0, len(candidates))
	for c := range candidates {
		candList = append(candList, c)
	}
	sort.Strings(candList)

	paths, err := menvio.CollectBackupPaths(root, registry.RegistryFilename, vaultFiles, candList, generate.HasOwnershipMarker)
	if err != nil {
		return "", nil, err
	}
	if _, err := menvio.CreateBackup(root, key, paths); err != nil {
		return "", nil, err
	}
	return key, paths, nil
}
