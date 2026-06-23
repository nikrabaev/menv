package io

import (
	"fmt"
	"os"
	"path/filepath"
)

// WriteFileAtomic writes content to root/rel using a tmp+rename sequence so
// the target file is never in a partially-written state. Parent directories are
// created as needed. There is NO implicit backup — only `menv backup` snapshots.
func WriteFileAtomic(root, rel string, content []byte) error {
	abs := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("creating parent dirs for %s: %w", rel, err)
	}
	tmp := abs + ".menv-tmp"
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return fmt.Errorf("writing tmp file %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, abs); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("renaming %s → %s: %w", tmp, abs, err)
	}
	return nil
}
