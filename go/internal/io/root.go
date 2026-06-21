package io

import (
	"os"
	"path/filepath"
)

const RegistryFilename = "menv.json"

// FindRoot walks from start toward the filesystem root looking for menv.json.
// Returns the containing directory, or ("", false) when not inside a menv repo.
// `init` treats the cwd as the new root; everything else errors.
func FindRoot(start string) (string, bool) {
	dir := start
	for {
		if _, err := os.Stat(filepath.Join(dir, RegistryFilename)); err == nil {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}
