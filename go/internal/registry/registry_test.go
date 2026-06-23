package registry_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/nikrabaev/menv/go/internal/registry"
	"github.com/nikrabaev/menv/go/tests/helpers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- ValidateRegistry tests ---

func TestValidateRegistry_Valid(t *testing.T) {
	r := helpers.MakeRegistry()
	issues := registry.ValidateRegistry(r)
	assert.Empty(t, issues, "baseline registry should be valid")
}

func TestValidateRegistry_SchemaVersion(t *testing.T) {
	r := helpers.MakeRegistry()
	r.SchemaVersion = 1
	issues := registry.ValidateRegistry(r)
	require.Len(t, issues, 1)
	assert.Equal(t, "schemaVersion", issues[0].Path)
}

func TestValidateRegistry_UnknownDefaultVault(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Defaults.Vault = "nonexistent"
	issues := registry.ValidateRegistry(r)
	require.Len(t, issues, 1)
	assert.Equal(t, "defaults.vault", issues[0].Path)
	assert.Contains(t, issues[0].Message, "nonexistent")
}

func TestValidateRegistry_InvalidVaultSlug(t *testing.T) {
	r := helpers.MakeRegistry()
	cfg, _ := json.Marshal(map[string]any{"filename": ".menv/v.json", "encryption": false})
	r.Vaults["Bad-Name"] = registry.VaultDef{VaultType: "menv-local", VaultConfig: cfg}
	issues := registry.ValidateRegistry(r)
	// default vault check should also fail since "local" is still there
	// but we should have at least one issue about the invalid name
	paths := make([]string, len(issues))
	for i, iss := range issues {
		paths[i] = iss.Path
	}
	assert.Contains(t, paths, "vaults.Bad-Name")
}

func TestValidateRegistry_MissingVaultType(t *testing.T) {
	r := helpers.MakeRegistry()
	cfg, _ := json.Marshal(map[string]any{"filename": ".menv/v.json"})
	r.Vaults["extra"] = registry.VaultDef{VaultType: "", VaultConfig: cfg}
	issues := registry.ValidateRegistry(r)
	paths := make([]string, len(issues))
	for i, iss := range issues {
		paths[i] = iss.Path
	}
	assert.Contains(t, paths, "vaults.extra.vaultType")
}

func TestValidateRegistry_ConsumerInvalidStrategy(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Consumers["bad"] = registry.ConsumerDef{
		StrategyType:   "unknown",
		StrategyConfig: registry.StrategyConfig{BaseDir: "apps/bad", Filename: ".env"},
	}
	issues := registry.ValidateRegistry(r)
	paths := make([]string, len(issues))
	for i, iss := range issues {
		paths[i] = iss.Path
	}
	assert.Contains(t, paths, "consumers.bad.strategyType")
}

func TestValidateRegistry_UnknownGroupRef(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["MY_VAR"] = registry.VariableDef{
		GroupKey:     "nonexistent",
		VaultMapping: map[string]map[string]registry.MappingEntry{},
	}
	issues := registry.ValidateRegistry(r)
	paths := make([]string, len(issues))
	for i, iss := range issues {
		paths[i] = iss.Path
	}
	assert.Contains(t, paths, "variables.MY_VAR.groupKey")
}

func TestValidateRegistry_UnknownVaultInMapping(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"ghost": {"api": {Key: "some-key"}},
		},
	}
	issues := registry.ValidateRegistry(r)
	paths := make([]string, len(issues))
	for i, iss := range issues {
		paths[i] = iss.Path
	}
	assert.Contains(t, paths, "variables.DB_URL.vaultMapping.ghost")
}

func TestValidateRegistry_GlobalInvalidName(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Globals["123INVALID"] = registry.GlobalDef{
		Values: map[string]registry.GlobalValueDef{},
	}
	issues := registry.ValidateRegistry(r)
	paths := make([]string, len(issues))
	for i, iss := range issues {
		paths[i] = iss.Path
	}
	assert.Contains(t, paths, "globals.123INVALID")
}

func TestValidateRegistry_StaticGlobalMissingValue(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Globals["NODE_ENV"] = registry.GlobalDef{
		Values: map[string]registry.GlobalValueDef{
			"local": {Source: "static", Value: ""},
		},
	}
	issues := registry.ValidateRegistry(r)
	paths := make([]string, len(issues))
	for i, iss := range issues {
		paths[i] = iss.Path
	}
	assert.Contains(t, paths, "globals.NODE_ENV.values.local.value")
}

// --- LoadRegistry / SaveRegistry tests ---

func TestRegistryRoundTrip(t *testing.T) {
	r := helpers.MakeRegistry()
	dir, err := os.MkdirTemp("", "menv-reg-test-")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(dir) })

	require.NoError(t, registry.SaveRegistry(dir, r))

	loaded, err := registry.LoadRegistry(dir)
	require.NoError(t, err)

	// Re-serialize both and compare JSON to avoid map ordering issues.
	gotJSON, _ := json.Marshal(loaded)
	wantJSON, _ := json.Marshal(r)
	assert.JSONEq(t, string(wantJSON), string(gotJSON))
}

func TestLoadRegistry_NotFound(t *testing.T) {
	dir, err := os.MkdirTemp("", "menv-reg-test-")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(dir) })

	_, err = registry.LoadRegistry(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "NOT_FOUND")
}

func TestLoadRegistry_InvalidJSON(t *testing.T) {
	dir, err := os.MkdirTemp("", "menv-reg-test-")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(dir) })

	require.NoError(t, os.WriteFile(filepath.Join(dir, "menv.json"), []byte("not json"), 0o644))
	_, err = registry.LoadRegistry(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PARSE")
}

func TestSaveRegistry_TrailingNewline(t *testing.T) {
	r := helpers.MakeRegistry()
	dir, err := os.MkdirTemp("", "menv-reg-test-")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(dir) })

	require.NoError(t, registry.SaveRegistry(dir, r))
	data, err := os.ReadFile(filepath.Join(dir, "menv.json"))
	require.NoError(t, err)
	assert.Equal(t, byte('\n'), data[len(data)-1], "saved file must end with newline")
}
