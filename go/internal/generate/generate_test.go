package generate_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/generate"
	"github.com/nikrabaev/menv/internal/registry"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- ownership ---

func TestOwnershipMarker(t *testing.T) {
	header := generate.DisclaimerHeader(generate.HeaderMeta{Vault: "local", Consumer: "api"})
	assert.True(t, generate.HasOwnershipMarker(header))
	assert.Contains(t, header, "vault: local")
	assert.Contains(t, header, "consumer: api")
}

func TestHasOwnershipMarker_False(t *testing.T) {
	assert.False(t, generate.HasOwnershipMarker("# just a comment\nFOO=bar\n"))
}

func TestStripDisclaimer(t *testing.T) {
	header := generate.DisclaimerHeader(generate.HeaderMeta{Vault: "local"})
	content := header + "FOO=bar\n"
	stripped := generate.StripDisclaimer(content)
	assert.False(t, generate.HasOwnershipMarker(stripped))
	assert.Contains(t, stripped, "FOO=bar")
}

func TestStripDisclaimer_NoMarker(t *testing.T) {
	content := "# user file\nFOO=bar\n"
	assert.Equal(t, content, generate.StripDisclaimer(content))
}

func TestHeaderVault(t *testing.T) {
	header := generate.DisclaimerHeader(generate.HeaderMeta{Vault: "production"})
	assert.Equal(t, "production", generate.HeaderVault(header))
}

func TestHeaderVault_None(t *testing.T) {
	assert.Equal(t, "", generate.HeaderVault("# user content"))
}

// --- render ---

func makeGroups() map[string]registry.GroupDef {
	return map[string]registry.GroupDef{
		"db": {Title: "Database"},
	}
}

func TestRenderEnvContent_Simple(t *testing.T) {
	entries := []generate.RenderEntry{
		{Name: "FOO", Value: "bar"},
		{Name: "BAZ", Value: "qux"},
	}
	content := generate.RenderEnvContent(entries, map[string]registry.GroupDef{}, "")
	assert.Contains(t, content, "FOO=bar")
	assert.Contains(t, content, "BAZ=qux")
}

func TestRenderEnvContent_Disabled(t *testing.T) {
	entries := []generate.RenderEntry{
		{Name: "FOO", Value: "bar", Disabled: true},
	}
	content := generate.RenderEnvContent(entries, map[string]registry.GroupDef{}, "")
	assert.Contains(t, content, "# FOO=bar")
}

func TestRenderEnvContent_GroupOrder(t *testing.T) {
	entries := []generate.RenderEntry{
		{Name: "DB_URL", Value: "postgres://", GroupKey: "db"},
		{Name: "APP_SECRET", Value: "secret"},
	}
	groups := makeGroups()
	content := generate.RenderEnvContent(entries, groups, "")
	dbIdx := strings.Index(content, "DB_URL")
	appIdx := strings.Index(content, "APP_SECRET")
	assert.Greater(t, appIdx, dbIdx, "ungrouped entries come after groups")
	assert.Contains(t, content, "# ── Database ──")
}

func TestRenderEnvContent_Empty(t *testing.T) {
	header := generate.DisclaimerHeader(generate.HeaderMeta{})
	content := generate.RenderEnvContent(nil, map[string]registry.GroupDef{}, header)
	assert.Equal(t, header, content)
}

func TestSplitSecrets_NoSplit(t *testing.T) {
	entries := []generate.RenderEntry{
		{Name: "FOO", Secret: false},
		{Name: "BAR", Secret: true},
	}
	main, local := generate.SplitSecrets(entries, false)
	assert.Len(t, main, 2)
	assert.Len(t, local, 0)
}

func TestSplitSecrets_WithSplit(t *testing.T) {
	entries := []generate.RenderEntry{
		{Name: "FOO", Secret: false},
		{Name: "BAR", Secret: true},
	}
	main, local := generate.SplitSecrets(entries, true)
	require.Len(t, main, 1)
	require.Len(t, local, 1)
	assert.Equal(t, "FOO", main[0].Name)
	assert.Equal(t, "BAR", local[0].Name)
}

func TestRenderExampleContent(t *testing.T) {
	entries := []generate.RenderEntry{
		{Name: "FOO", Value: "ignored", Example: "example-value"},
	}
	content := generate.RenderExampleContent(entries, map[string]registry.GroupDef{}, "")
	assert.Contains(t, content, "FOO=example-value")
	assert.NotContains(t, content, "ignored")
}

// --- compose markers ---

func TestFindMarkerRegions_Simple(t *testing.T) {
	content := "version: '3'\nservices:\n  api:\n    env_file:\n    # <menv:api>\n    # </menv>\n"
	regions, errs := generate.FindMarkerRegions(content)
	assert.Empty(t, errs)
	require.Len(t, regions, 1)
	assert.Equal(t, "api", regions[0].Consumer)
}

func TestFindMarkerRegions_NestedError(t *testing.T) {
	content := "# <menv:api>\n# <menv:web>\n# </menv>\n"
	_, errs := generate.FindMarkerRegions(content)
	assert.NotEmpty(t, errs)
	assert.Contains(t, errs[0], "nested")
}

func TestFindMarkerRegions_UnmatchedClose(t *testing.T) {
	content := "# </menv>\n"
	_, errs := generate.FindMarkerRegions(content)
	assert.NotEmpty(t, errs)
	assert.Contains(t, errs[0], "unmatched")
}

func TestFindMarkerRegions_UnclosedOpen(t *testing.T) {
	content := "# <menv:api>\n"
	_, errs := generate.FindMarkerRegions(content)
	assert.NotEmpty(t, errs)
	assert.Contains(t, errs[0], "unclosed")
}

func TestSpliceRegions(t *testing.T) {
	content := "before\n# <menv:api>\nold\n# </menv>\nafter"
	regions, _ := generate.FindMarkerRegions(content)
	require.Len(t, regions, 1)
	fill := map[int][]string{regions[0].Start: {"    - FOO=${API_FOO}"}}
	result := generate.SpliceRegions(content, regions, fill)
	assert.Contains(t, result, "    - FOO=${API_FOO}")
	assert.NotContains(t, result, "old")
	assert.Contains(t, result, "before")
	assert.Contains(t, result, "after")
}

func TestComposeKey(t *testing.T) {
	assert.Equal(t, "API_FOO", generate.ComposeKey("api", "FOO"))
	assert.Equal(t, "MY_SERVICE_BAR", generate.ComposeKey("my-service", "BAR"))
}

// --- paths ---

func TestEnvTargets_Single(t *testing.T) {
	consumers := map[string]registry.ConsumerDef{
		"api": {
			StrategyType: "single",
			StrategyConfig: registry.StrategyConfig{
				BaseDir:  "apps/api",
				Filename: ".env",
			},
		},
	}
	defaults := registry.Defaults{Vault: "local"}
	targets := generate.EnvTargets(consumers, defaults, generate.GenerateOpts{})
	require.Len(t, targets, 1)
	assert.Equal(t, "api", targets[0].Consumer)
	assert.Equal(t, "local", targets[0].Vault)
	assert.Equal(t, filepath.Join("apps/api", ".env"), targets[0].RelPath)
}

func TestEnvTargets_FilterConsumer(t *testing.T) {
	consumers := map[string]registry.ConsumerDef{
		"api": {StrategyType: "single", StrategyConfig: registry.StrategyConfig{BaseDir: "apps/api", Filename: ".env"}},
		"web": {StrategyType: "single", StrategyConfig: registry.StrategyConfig{BaseDir: "apps/web", Filename: ".env"}},
	}
	targets := generate.EnvTargets(consumers, registry.Defaults{Vault: "local"}, generate.GenerateOpts{Consumer: "api"})
	require.Len(t, targets, 1)
	assert.Equal(t, "api", targets[0].Consumer)
}

// --- PreviewGenerate ---

type mockSession struct {
	store map[string]string
}

func (m *mockSession) Get(key string) (string, bool, error) {
	v, ok := m.store[key]
	return v, ok, nil
}
func (m *mockSession) Set(key, value string) error      { m.store[key] = value; return nil }
func (m *mockSession) Remove(key string) error          { delete(m.store, key); return nil }
func (m *mockSession) List() ([]string, error)          { return nil, nil }
func (m *mockSession) Close() error                     { return nil }

func makeTestRegistry() registry.Registry {
	return registry.Registry{
		SchemaVersion: 2,
		Defaults:      registry.Defaults{Vault: "local"},
		Vaults: map[string]registry.VaultDef{
			"local": {VaultType: "menv-local"},
		},
		Consumers: map[string]registry.ConsumerDef{
			"api": {
				StrategyType: "single",
				StrategyConfig: registry.StrategyConfig{
					BaseDir:  "apps/api",
					Filename: ".env",
				},
			},
		},
		Groups:    map[string]registry.GroupDef{},
		Globals:   map[string]registry.GlobalDef{},
		Variables: map[string]registry.VariableDef{},
		Compose:   registry.Compose{Files: []string{}},
	}
}

func TestPreviewGenerate_NewFile(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "apps/api"), 0755))

	reg := makeTestRegistry()
	reg.Variables["DATABASE_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "k1"}},
		},
	}

	sess := &mockSession{store: map[string]string{"k1": "postgres://localhost/db"}}
	sessions := map[string]core.VaultSession{"local": sess}

	preview, err := generate.PreviewGenerate(root, reg, generate.GenerateOpts{}, sessions)
	require.NoError(t, err)
	require.Len(t, preview.Writes, 1)
	assert.Contains(t, preview.Writes[0].Content, "DATABASE_URL=postgres://localhost/db")
	assert.True(t, generate.HasOwnershipMarker(preview.Writes[0].Content))
}

func TestPreviewGenerate_Unchanged(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "apps/api"), 0755))

	reg := makeTestRegistry()
	sess := &mockSession{store: map[string]string{}}
	sessions := map[string]core.VaultSession{"local": sess}

	// First pass — write
	preview1, err := generate.PreviewGenerate(root, reg, generate.GenerateOpts{}, sessions)
	require.NoError(t, err)
	require.NoError(t, generate.ApplyPreview(root, preview1))

	// Second pass — should be unchanged
	preview2, err := generate.PreviewGenerate(root, reg, generate.GenerateOpts{}, sessions)
	require.NoError(t, err)
	assert.Empty(t, preview2.Writes)
	assert.Len(t, preview2.Unchanged, 1)
}

func TestPreviewGenerate_Refused(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "apps/api"), 0755))
	// Write a user-owned file (no ownership marker)
	require.NoError(t, os.WriteFile(filepath.Join(root, "apps/api/.env"), []byte("# user file\n"), 0644))

	reg := makeTestRegistry()
	sess := &mockSession{store: map[string]string{}}
	sessions := map[string]core.VaultSession{"local": sess}

	preview, err := generate.PreviewGenerate(root, reg, generate.GenerateOpts{}, sessions)
	require.NoError(t, err)
	assert.Empty(t, preview.Writes)
	assert.Len(t, preview.Refused, 1)
}

// --- ApplyFileOp ---

func TestApplyFileOp_Release(t *testing.T) {
	root := t.TempDir()
	header := generate.DisclaimerHeader(generate.HeaderMeta{})
	content := header + "FOO=bar\n"
	require.NoError(t, os.WriteFile(filepath.Join(root, "test.env"), []byte(content), 0644))

	op := core.FileOp{Action: "release", Path: "test.env"}
	require.NoError(t, generate.ApplyFileOp(root, op))

	result, _ := os.ReadFile(filepath.Join(root, "test.env"))
	assert.False(t, generate.HasOwnershipMarker(string(result)))
	assert.Contains(t, string(result), "FOO=bar")
}

func TestApplyFileOp_Delete(t *testing.T) {
	root := t.TempDir()
	header := generate.DisclaimerHeader(generate.HeaderMeta{})
	require.NoError(t, os.WriteFile(filepath.Join(root, "test.env"), []byte(header+"FOO=bar\n"), 0644))

	op := core.FileOp{Action: "delete", Path: "test.env"}
	require.NoError(t, generate.ApplyFileOp(root, op))

	_, err := os.Stat(filepath.Join(root, "test.env"))
	assert.True(t, os.IsNotExist(err))
}

func TestApplyFileOp_NoMarker_NotDeleted(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "test.env"), []byte("# user file\n"), 0644))

	op := core.FileOp{Action: "delete", Path: "test.env"}
	require.NoError(t, generate.ApplyFileOp(root, op))

	_, err := os.Stat(filepath.Join(root, "test.env"))
	assert.NoError(t, err, "user-owned file must not be deleted")
}
