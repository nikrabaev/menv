package ops_test

import (
	"testing"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/core/ops"
	"github.com/nikrabaev/menv/internal/registry"
	"github.com/nikrabaev/menv/tests/helpers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newKey() string { return "test-key-" + "uuid" }

var keySeq int

func seqKey() string {
	keySeq++
	return "k" + string(rune('0'+keySeq))
}

// --- Variable ops ---

func TestPlanVarDefine(t *testing.T) {
	r := helpers.MakeRegistry()
	res, err := ops.PlanVarDefine(r, ops.VarDefineInput{Name: "MY_VAR"})
	require.NoError(t, err)
	_, exists := res.Next.Variables["MY_VAR"]
	assert.True(t, exists)
	require.Len(t, res.Plan.Registry, 1)
	assert.Equal(t, "set", res.Plan.Registry[0].Action)
}

func TestPlanVarDefine_AlreadyExists(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["MY_VAR"] = registry.VariableDef{VaultMapping: map[string]map[string]registry.MappingEntry{}}
	_, err := ops.PlanVarDefine(r, ops.VarDefineInput{Name: "MY_VAR"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already exists")
}

func TestPlanVarDefine_InvalidName(t *testing.T) {
	r := helpers.MakeRegistry()
	_, err := ops.PlanVarDefine(r, ops.VarDefineInput{Name: "123invalid"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "VALIDATION")
}

func TestPlanVarRemove_Cascade(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "k1"}},
		},
	}
	res, err := ops.PlanVarRemove(r, ops.VarRemoveInput{
		Name:     "DB_URL",
		Openable: map[string]bool{"local": true},
	})
	require.NoError(t, err)
	_, stillExists := res.Next.Variables["DB_URL"]
	assert.False(t, stillExists)
	// Should queue vault key removal
	require.Len(t, res.Plan.Vaults, 1)
	assert.Equal(t, "remove", res.Plan.Vaults[0].Action)
	assert.Equal(t, "k1", res.Plan.Vaults[0].Key)
}

func TestPlanVarRemove_DependentBlocks(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{VaultMapping: map[string]map[string]registry.MappingEntry{}}
	res, err := ops.PlanVarRemove(r, ops.VarRemoveInput{
		Name: "DB_URL",
		Records: []core.ValueRecord{
			{Variable: "OTHER", Vault: "local", Consumer: "api", Raw: "${DB_URL}/extra"},
		},
		Openable: map[string]bool{},
	})
	require.NoError(t, err)
	require.Len(t, res.Plan.Blockers, 1)
	assert.Equal(t, "DEPENDENT_REFERENCE", res.Plan.Blockers[0].Code)
}

// --- Vault ops ---

func TestPlanVaultAdd(t *testing.T) {
	r := helpers.MakeRegistry()
	res, err := ops.PlanVaultAdd(r, ops.VaultAddInput{
		Name:        "staging",
		VaultType:   "menv-local",
		VaultConfig: map[string]any{"filename": ".menv/staging.json", "encryption": false},
	})
	require.NoError(t, err)
	_, exists := res.Next.Vaults["staging"]
	assert.True(t, exists)
}

func TestPlanVaultRemove_DefaultBlocks(t *testing.T) {
	r := helpers.MakeRegistry()
	_, err := ops.PlanVaultRemove(r, struct{ Name string }{"local"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "default vault")
}

func TestPlanVaultRemove_CascadesVariables(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"production": {"api": {Key: "k1"}},
		},
	}
	res, err := ops.PlanVaultRemove(r, struct{ Name string }{"production"})
	require.NoError(t, err)
	assert.Empty(t, res.Next.Variables["DB_URL"].VaultMapping["production"])
	require.NotEmpty(t, res.Plan.Blockers)
	assert.Equal(t, "VAULT_IN_USE", res.Plan.Blockers[0].Code)
}

// --- Group ops ---

func TestPlanGroupAdd(t *testing.T) {
	r := helpers.MakeRegistry()
	res, err := ops.PlanGroupAdd(r, struct{ Key, Title string }{"infra", "Infrastructure"})
	require.NoError(t, err)
	assert.Equal(t, "Infrastructure", res.Next.Groups["infra"].Title)
}

func TestPlanGroupRemove_ClearsMembers(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		GroupKey:     "db",
		VaultMapping: map[string]map[string]registry.MappingEntry{},
	}
	res, err := ops.PlanGroupRemove(r, struct{ Key string }{"db"})
	require.NoError(t, err)
	assert.Equal(t, "", res.Next.Variables["DB_URL"].GroupKey)
	require.NotEmpty(t, res.Plan.Blockers)
	assert.Equal(t, "GROUP_IN_USE", res.Plan.Blockers[0].Code)
}

// --- Consumer ops ---

func TestPlanConsumerAdd(t *testing.T) {
	r := helpers.MakeRegistry()
	res, err := ops.PlanConsumerAdd(r, ops.ConsumerAddInput{
		Name:         "mobile",
		StrategyType: "single",
		BaseDir:      "apps/mobile",
		Filename:     ".env",
	})
	require.NoError(t, err)
	_, exists := res.Next.Consumers["mobile"]
	assert.True(t, exists)
}

func TestPlanConsumerRemove_Cascade(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "k1"}},
		},
	}
	res, err := ops.PlanConsumerRemove(r, ops.ConsumerRemoveInput{
		Name:     "api",
		Openable: map[string]bool{"local": true},
	})
	require.NoError(t, err)
	_, exists := res.Next.Consumers["api"]
	assert.False(t, exists)
	assert.Empty(t, res.Next.Variables["DB_URL"].VaultMapping["local"])
	// Vault key should be queued for removal
	require.NotEmpty(t, res.Plan.Vaults)
	assert.Equal(t, "k1", res.Plan.Vaults[0].Key)
}

// --- Wiring ops ---

func TestPlanWire(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{VaultMapping: map[string]map[string]registry.MappingEntry{}}
	res, err := ops.PlanWire(r, ops.WireInput{
		Name:      "DB_URL",
		Vault:     "local",
		Consumers: []string{"api"},
		NewKey:    func() string { return "gen-key" },
	})
	require.NoError(t, err)
	entry := res.Next.Variables["DB_URL"].VaultMapping["local"]["api"]
	assert.Equal(t, "gen-key", entry.Key)
}

func TestPlanWire_AlreadyWiredErrors(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "k1"}},
		},
	}
	_, err := ops.PlanWire(r, ops.WireInput{
		Name:      "DB_URL",
		Vault:     "local",
		Consumers: []string{"api"},
		NewKey:    func() string { return "k2" },
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already wired")
}

func TestPlanWire_SharedAndKeyMutuallyExclusive(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{VaultMapping: map[string]map[string]registry.MappingEntry{}}
	_, err := ops.PlanWire(r, ops.WireInput{
		Name: "DB_URL", Vault: "local",
		Consumers: []string{"api"},
		Shared:    true,
		Key:       "existing-key",
		NewKey:    func() string { return "k" },
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "mutually exclusive")
}

func TestPlanWire_OrphanedKeyWarning(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "old-key"}},
		},
	}
	keySeq := 0
	res, err := ops.PlanWire(r, ops.WireInput{
		Name:      "DB_URL",
		Vault:     "local",
		Consumers: []string{"api"},
		Key:       "new-key", // re-key
		NewKey:    func() string { keySeq++; return "g" },
	})
	require.NoError(t, err)
	// old-key is now orphaned (not removeOrphans) → warning
	require.NotEmpty(t, res.Plan.Warnings)
	assert.Equal(t, "ORPHANED_KEYS", res.Plan.Warnings[0].Code)
}

func TestPlanUnwire(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {
				"api": {Key: "k1"},
				"web": {Key: "k1"}, // shared
			},
		},
	}
	res, err := ops.PlanUnwire(r, ops.UnwireInput{
		Name:      "DB_URL",
		Vault:     "local",
		Consumers: []string{"api"},
		Openable:  map[string]bool{"local": true},
	})
	require.NoError(t, err)
	_, apiExists := res.Next.Variables["DB_URL"].VaultMapping["local"]["api"]
	assert.False(t, apiExists)
	// web still holds k1, so it should NOT be queued for removal
	assert.Empty(t, res.Plan.Vaults)
}

// --- Value ops ---

func TestPlanSetValue(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "k1"}, "web": {Key: "k1"}},
		},
	}
	res, err := ops.PlanSetValue(r, ops.SetValueInput{
		KeyQuery: ops.KeyQuery{Name: "DB_URL", Vault: "local"},
		Value:    "postgres://localhost/db",
	})
	require.NoError(t, err)
	require.Len(t, res.Plan.Vaults, 1)
	assert.Equal(t, "k1", res.Plan.Vaults[0].Key)
	assert.Equal(t, "postgres://localhost/db", res.Plan.Vaults[0].Value)
}

func TestPlanSetValue_AmbiguousErrors(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {
				"api": {Key: "k1"},
				"web": {Key: "k2"}, // different keys!
			},
		},
	}
	_, err := ops.PlanSetValue(r, ops.SetValueInput{
		KeyQuery: ops.KeyQuery{Name: "DB_URL", Vault: "local"},
		Value:    "v",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AMBIGUOUS")
}

func TestPlanSetUniqueValue_Splits(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["DB_URL"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {
				"api": {Key: "shared-key"},
				"web": {Key: "shared-key"},
			},
		},
	}
	res, err := ops.PlanSetUniqueValue(r, ops.SetUniqueValueInput{
		Name:     "DB_URL",
		Vault:    "local",
		Consumer: "api",
		Value:    "private",
		NewKey:   func() string { return "new-private-key" },
	})
	require.NoError(t, err)
	// Registry op should re-key api
	require.Len(t, res.Plan.Registry, 1)
	assert.Contains(t, res.Plan.Registry[0].Path, "api")
	// Vault op should set on new key
	require.Len(t, res.Plan.Vaults, 1)
	assert.Equal(t, "new-private-key", res.Plan.Vaults[0].Key)
	assert.Equal(t, "private", res.Plan.Vaults[0].Value)
}

// --- Compose ops ---

func TestPlanComposeBind(t *testing.T) {
	r := helpers.MakeRegistry()
	res, err := ops.PlanComposeBind(r, struct{ File string }{"docker-compose.yml"})
	require.NoError(t, err)
	assert.Contains(t, res.Next.Compose.Files, "docker-compose.yml")
}

func TestPlanComposeUnbind(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Compose.Files = []string{"docker-compose.yml"}
	res, err := ops.PlanComposeUnbind(r, struct{ File string }{"docker-compose.yml"})
	require.NoError(t, err)
	assert.NotContains(t, res.Next.Compose.Files, "docker-compose.yml")
}

// --- SetDisabled ---

func TestPlanSetDisabled(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["FLAG"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "k1"}},
		},
	}
	res, err := ops.PlanSetDisabled(r, ops.SetDisabledInput{
		Name: "FLAG", Vault: "local", Consumer: "api", Disabled: true,
	})
	require.NoError(t, err)
	assert.True(t, res.Next.Variables["FLAG"].VaultMapping["local"]["api"].Disabled)
}

func TestPlanSetDisabled_Noop(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Variables["FLAG"] = registry.VariableDef{
		VaultMapping: map[string]map[string]registry.MappingEntry{
			"local": {"api": {Key: "k1", Disabled: true}},
		},
	}
	res, err := ops.PlanSetDisabled(r, ops.SetDisabledInput{
		Name: "FLAG", Vault: "local", Consumer: "api", Disabled: true,
	})
	require.NoError(t, err)
	require.Len(t, res.Plan.Warnings, 1)
	assert.Equal(t, "NOOP", res.Plan.Warnings[0].Code)
}

// --- Global ops ---

func TestPlanGlobalDefine(t *testing.T) {
	r := helpers.MakeRegistry()
	res, err := ops.PlanGlobalDefine(r, ops.GlobalWriteInput{
		Name:   "NODE_ENV",
		Vault:  "local",
		Source: "static",
		Value:  "development",
	})
	require.NoError(t, err)
	g := res.Next.Globals["NODE_ENV"]
	assert.Equal(t, "static", g.Values["local"].Source)
	assert.Equal(t, "development", g.Values["local"].Value)
}

func TestPlanGlobalRemove_DependentBlocks(t *testing.T) {
	r := helpers.MakeRegistry()
	r.Globals["NODE_ENV"] = registry.GlobalDef{
		Values: map[string]registry.GlobalValueDef{
			"local": {Source: "static", Value: "development"},
		},
	}
	res, err := ops.PlanGlobalRemove(r, ops.GlobalRemoveInput{
		Name: "NODE_ENV",
		Records: []core.ValueRecord{
			{Variable: "MY_VAR", Vault: "local", Consumer: "api", Raw: "${NODE_ENV}_app"},
		},
	})
	require.NoError(t, err)
	require.Len(t, res.Plan.Blockers, 1)
	assert.Equal(t, "DEPENDENT_REFERENCE", res.Plan.Blockers[0].Code)
}

// --- CloneRegistry (immutability) ---

func TestCloneRegistry_Immutable(t *testing.T) {
	r := helpers.MakeRegistry()
	clone := ops.CloneRegistry(r)
	clone.Variables["INJECTED"] = registry.VariableDef{VaultMapping: map[string]map[string]registry.MappingEntry{}}
	_, exists := r.Variables["INJECTED"]
	assert.False(t, exists, "mutating clone must not affect original")
}

// --- MergePlans ---

func TestMergePlans(t *testing.T) {
	a := core.EmptyPlan()
	a.Registry = append(a.Registry, core.RegistryOp{Action: "set", Path: "a"})
	b := core.EmptyPlan()
	b.Registry = append(b.Registry, core.RegistryOp{Action: "set", Path: "b"})
	merged := ops.MergePlans(a, b)
	require.Len(t, merged.Registry, 2)
	assert.Equal(t, "a", merged.Registry[0].Path)
	assert.Equal(t, "b", merged.Registry[1].Path)
}
