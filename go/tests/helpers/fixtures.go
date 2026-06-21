package helpers

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/nikrabaev/menv/internal/registry"
)

// MakeRegistry returns a baseline 2-vault, 2-consumer, 1-group registry.
// Tests mutate copies via field assignment or overrides.
func MakeRegistry() registry.Registry {
	localConfig, _ := json.Marshal(map[string]any{
		"filename":   ".menv/vault.json",
		"encryption": false,
	})
	prodConfig, _ := json.Marshal(map[string]any{
		"filename":   ".menv/vault.production.json",
		"encryption": false,
	})
	return registry.Registry{
		SchemaVersion: 2,
		Defaults:      registry.Defaults{Vault: "local"},
		Vaults: map[string]registry.VaultDef{
			"local": {
				VaultType:   "menv-local",
				VaultConfig: json.RawMessage(localConfig),
			},
			"production": {
				VaultType:   "menv-local",
				VaultConfig: json.RawMessage(prodConfig),
			},
		},
		Consumers: map[string]registry.ConsumerDef{
			"api": {
				StrategyType: "single",
				StrategyConfig: registry.StrategyConfig{
					BaseDir:  "apps/api",
					Filename: ".env",
				},
			},
			"web": {
				StrategyType: "single",
				StrategyConfig: registry.StrategyConfig{
					BaseDir:  "apps/web",
					Filename: ".env",
				},
			},
		},
		Groups: map[string]registry.GroupDef{
			"db": {Title: "Database"},
		},
		Globals:   map[string]registry.GlobalDef{},
		Variables: map[string]registry.VariableDef{},
		Compose:   registry.Compose{Files: []string{}},
	}
}

// TmpRepo creates a temporary directory, optionally saving a registry into it.
// Calls t.Cleanup to remove the directory when the test ends.
func TmpRepo(t *testing.T, r *registry.Registry) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "menv-test-")
	if err != nil {
		t.Fatalf("TmpRepo: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	if r != nil {
		if err := registry.SaveRegistry(dir, *r); err != nil {
			t.Fatalf("TmpRepo SaveRegistry: %v", err)
		}
	}
	return dir
}
