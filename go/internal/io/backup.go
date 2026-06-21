package io

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const BackupsDir = ".menv/backups"

// BackupKey returns a timestamp-based key like "20260621-143022".
func BackupKey(t time.Time) string {
	return fmt.Sprintf("%04d%02d%02d-%02d%02d%02d",
		t.Year(), int(t.Month()), t.Day(),
		t.Hour(), t.Minute(), t.Second())
}

// CollectBackupPaths returns all paths that should be included in a backup:
// the registry, menv-local vault files that exist, and all menv-managed
// generated files (those bearing the ownership marker).
//
// The ownershipMarker parameter is the first-line marker string; the
// checkOwnership function is provided so this package doesn't import generate.
func CollectBackupPaths(root string, registryFilename string, vaultFilenames []string, generatedCandidates []string, hasOwnership func(string) bool) ([]string, error) {
	out := map[string]bool{}

	if _, err := os.Stat(filepath.Join(root, registryFilename)); err == nil {
		out[registryFilename] = true
	}
	for _, f := range vaultFilenames {
		if _, err := os.Stat(filepath.Join(root, f)); err == nil {
			out[f] = true
		}
	}
	for _, rel := range generatedCandidates {
		abs := filepath.Join(root, rel)
		data, err := os.ReadFile(abs)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if hasOwnership(string(data)) {
			out[rel] = true
		}
	}
	result := make([]string, 0, len(out))
	for p := range out {
		result = append(result, p)
	}
	sort.Strings(result)
	return result, nil
}

// CreateBackup copies each path to .menv/backups/<key>/<path> and returns
// the relative backup directory.
func CreateBackup(root, key string, paths []string) (string, error) {
	for _, rel := range paths {
		dest := filepath.Join(root, BackupsDir, key, rel)
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return "", err
		}
		if err := copyFile(filepath.Join(root, rel), dest); err != nil {
			return "", err
		}
	}
	return filepath.Join(BackupsDir, key), nil
}

// ListBackups returns backup keys (directory names) sorted ascending.
func ListBackups(root string) ([]string, error) {
	dir := filepath.Join(root, BackupsDir)
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var keys []string
	for _, e := range entries {
		if e.IsDir() {
			keys = append(keys, e.Name())
		}
	}
	sort.Strings(keys)
	return keys, nil
}

// RestoreBackup copies all files from a backup back to root.
func RestoreBackup(root, key string) ([]string, error) {
	base := filepath.Join(root, BackupsDir, key)
	var restored []string
	if err := walkRestore(base, "", root, &restored); err != nil {
		return nil, err
	}
	sort.Strings(restored)
	return restored, nil
}

func walkRestore(base, relDir, root string, restored *[]string) error {
	dir := filepath.Join(base, relDir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		rel := e.Name()
		if relDir != "" {
			rel = filepath.Join(relDir, e.Name())
		}
		if e.IsDir() {
			if err := walkRestore(base, rel, root, restored); err != nil {
				return err
			}
		} else {
			dest := filepath.Join(root, rel)
			if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
				return err
			}
			if err := copyFile(filepath.Join(base, rel), dest); err != nil {
				return err
			}
			*restored = append(*restored, rel)
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// LocalVaultFilenames extracts the filenames of all menv-local vaults from a
// raw registry JSON (to avoid importing the registry package here).
func LocalVaultFilenames(registryJSON []byte) []string {
	var reg struct {
		Vaults map[string]struct {
			VaultType   string          `json:"vaultType"`
			VaultConfig json.RawMessage `json:"vaultConfig"`
		} `json:"vaults"`
	}
	if err := json.Unmarshal(registryJSON, &reg); err != nil {
		return nil
	}
	var out []string
	for _, v := range reg.Vaults {
		if v.VaultType != "menv-local" {
			continue
		}
		var cfg struct {
			Filename string `json:"filename"`
		}
		if err := json.Unmarshal(v.VaultConfig, &cfg); err == nil && cfg.Filename != "" {
			out = append(out, cfg.Filename)
		}
	}
	sort.Strings(out)
	return out
}
