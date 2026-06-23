package io_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- ParseDotenv ---

func TestParseDotenv_Simple(t *testing.T) {
	entries := menvio.ParseDotenv("FOO=bar\nBAZ=qux\n")
	require.Len(t, entries, 2)
	assert.Equal(t, "FOO", entries[0].Key)
	assert.Equal(t, "bar", entries[0].Value)
}

func TestParseDotenv_SkipsComments(t *testing.T) {
	entries := menvio.ParseDotenv("# comment\nFOO=bar\n")
	require.Len(t, entries, 1)
	assert.Equal(t, "FOO", entries[0].Key)
}

func TestParseDotenv_SkipsBlanks(t *testing.T) {
	entries := menvio.ParseDotenv("\n\nFOO=bar\n\n")
	require.Len(t, entries, 1)
}

func TestParseDotenv_ExportPrefix(t *testing.T) {
	entries := menvio.ParseDotenv("export FOO=bar\n")
	require.Len(t, entries, 1)
	assert.Equal(t, "FOO", entries[0].Key)
	assert.Equal(t, "bar", entries[0].Value)
}

func TestParseDotenv_DoubleQuotes(t *testing.T) {
	entries := menvio.ParseDotenv(`FOO="hello world"` + "\n")
	require.Len(t, entries, 1)
	assert.Equal(t, "hello world", entries[0].Value)
}

func TestParseDotenv_SingleQuotes(t *testing.T) {
	entries := menvio.ParseDotenv("FOO='hello world'\n")
	require.Len(t, entries, 1)
	assert.Equal(t, "hello world", entries[0].Value)
}

func TestParseDotenv_InlineComment(t *testing.T) {
	entries := menvio.ParseDotenv("FOO=bar # inline comment\n")
	require.Len(t, entries, 1)
	assert.Equal(t, "bar", entries[0].Value)
}

func TestParseDotenv_EmptyValue(t *testing.T) {
	entries := menvio.ParseDotenv("FOO=\n")
	require.Len(t, entries, 1)
	assert.Equal(t, "", entries[0].Value)
}

func TestParseDotenv_NoEquals(t *testing.T) {
	entries := menvio.ParseDotenv("NOEQ\n")
	assert.Empty(t, entries)
}

// --- UpsertManagedBlock ---

func TestUpsertManagedBlock_NewFile(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, menvio.UpsertManagedBlock(root, []string{".env", ".menv/"}))

	data, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	require.NoError(t, err)
	content := string(data)
	assert.Contains(t, content, "# menv (managed block)")
	assert.Contains(t, content, ".env")
	assert.Contains(t, content, ".menv/")
	assert.Contains(t, content, "# end menv")
}

func TestUpsertManagedBlock_Idempotent(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, menvio.UpsertManagedBlock(root, []string{".env"}))
	require.NoError(t, menvio.UpsertManagedBlock(root, []string{".env"}))

	data, _ := os.ReadFile(filepath.Join(root, ".gitignore"))
	// Should not duplicate the block
	content := string(data)
	firstIdx := len(content) - len(content[indexOf(content, "# menv"):])
	_ = firstIdx
	// Count occurrences
	count := countOccurrences(content, "# menv (managed block)")
	assert.Equal(t, 1, count)
}

func TestUpsertManagedBlock_UnionEntries(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, menvio.UpsertManagedBlock(root, []string{".env"}))
	require.NoError(t, menvio.UpsertManagedBlock(root, []string{".env", ".menv/"}))

	data, _ := os.ReadFile(filepath.Join(root, ".gitignore"))
	content := string(data)
	assert.Contains(t, content, ".env")
	assert.Contains(t, content, ".menv/")
}

func TestUpsertManagedBlock_PreservesUserContent(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, ".gitignore"), []byte("node_modules/\n"), 0644))
	require.NoError(t, menvio.UpsertManagedBlock(root, []string{".env"}))

	data, _ := os.ReadFile(filepath.Join(root, ".gitignore"))
	content := string(data)
	assert.Contains(t, content, "node_modules/")
	assert.Contains(t, content, ".env")
}

func indexOf(s, substr string) int {
	for i := range s {
		if len(s[i:]) >= len(substr) && s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func countOccurrences(s, substr string) int {
	count := 0
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			count++
			i += len(substr) - 1
		}
	}
	return count
}

// --- BackupKey ---

func TestBackupKey(t *testing.T) {
	ts := time.Date(2026, 6, 21, 14, 30, 22, 0, time.UTC)
	assert.Equal(t, "20260621-143022", menvio.BackupKey(ts))
}

// --- CreateBackup / ListBackups / RestoreBackup ---

func TestBackup_RoundTrip(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "menv.json"), []byte(`{"schemaVersion":2}`), 0644))

	paths, err := menvio.CollectBackupPaths(root, "menv.json", nil, nil, func(_ string) bool { return false })
	require.NoError(t, err)
	assert.Contains(t, paths, "menv.json")

	dir, err := menvio.CreateBackup(root, "20260621-000000", paths)
	require.NoError(t, err)
	assert.Equal(t, ".menv/backups/20260621-000000", dir)

	keys, err := menvio.ListBackups(root)
	require.NoError(t, err)
	assert.Equal(t, []string{"20260621-000000"}, keys)

	// Modify the original.
	require.NoError(t, os.WriteFile(filepath.Join(root, "menv.json"), []byte(`changed`), 0644))

	restored, err := menvio.RestoreBackup(root, "20260621-000000")
	require.NoError(t, err)
	assert.Contains(t, restored, "menv.json")

	data, _ := os.ReadFile(filepath.Join(root, "menv.json"))
	assert.Equal(t, `{"schemaVersion":2}`, string(data))
}

func TestListBackups_Empty(t *testing.T) {
	root := t.TempDir()
	keys, err := menvio.ListBackups(root)
	require.NoError(t, err)
	assert.Empty(t, keys)
}
