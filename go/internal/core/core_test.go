package core_test

import (
	"encoding/json"
	"testing"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Tokenize / ExtractRefs ---

func TestTokenize_Text(t *testing.T) {
	segs := core.Tokenize("hello world")
	require.Len(t, segs, 1)
	assert.Equal(t, "text", segs[0].Kind)
	assert.Equal(t, "hello world", segs[0].Text)
}

func TestTokenize_Ref(t *testing.T) {
	segs := core.Tokenize("${DB_URL}")
	require.Len(t, segs, 1)
	assert.Equal(t, "ref", segs[0].Kind)
	assert.Equal(t, "DB_URL", segs[0].Text)
}

func TestTokenize_Mixed(t *testing.T) {
	segs := core.Tokenize("postgres://${HOST}:${PORT}/db")
	require.Len(t, segs, 5)
	assert.Equal(t, "text", segs[0].Kind) // "postgres://"
	assert.Equal(t, "ref", segs[1].Kind)  // HOST
	assert.Equal(t, "text", segs[2].Kind) // ":"
	assert.Equal(t, "ref", segs[3].Kind)  // PORT
	assert.Equal(t, "text", segs[4].Kind) // "/db"
}

func TestTokenize_EscapedRef(t *testing.T) {
	segs := core.Tokenize("$${NOT_A_REF}")
	require.Len(t, segs, 1)
	assert.Equal(t, "text", segs[0].Kind)
	assert.Equal(t, "${NOT_A_REF}", segs[0].Text)
}

func TestTokenize_MalformedKeptLiteral(t *testing.T) {
	segs := core.Tokenize("${123invalid}")
	require.Len(t, segs, 1)
	assert.Equal(t, "text", segs[0].Kind)
}

func TestExtractRefs(t *testing.T) {
	refs := core.ExtractRefs("${A} and ${B} but $${C}")
	assert.Equal(t, []string{"A", "B"}, refs)
}

// --- ExpandAll ---

func TestExpandAll_Simple(t *testing.T) {
	result, err := core.ExpandAll(core.ExpandInput{
		Values:  map[string]string{"URL": "postgres://localhost/db"},
		Globals: map[string]core.GlobalResolution{},
	})
	require.NoError(t, err)
	assert.Equal(t, "postgres://localhost/db", result["URL"])
}

func TestExpandAll_VarRef(t *testing.T) {
	result, err := core.ExpandAll(core.ExpandInput{
		Values: map[string]string{
			"HOST": "localhost",
			"URL":  "postgres://${HOST}/db",
		},
		Globals: map[string]core.GlobalResolution{},
	})
	require.NoError(t, err)
	assert.Equal(t, "postgres://localhost/db", result["URL"])
}

func TestExpandAll_StaticGlobal(t *testing.T) {
	result, err := core.ExpandAll(core.ExpandInput{
		Values: map[string]string{
			"URL": "postgres://${HOST}/db",
		},
		Globals: map[string]core.GlobalResolution{
			"HOST": {Kind: "static", Value: "db.prod"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "postgres://db.prod/db", result["URL"])
}

func TestExpandAll_RuntimeGlobal(t *testing.T) {
	result, err := core.ExpandAll(core.ExpandInput{
		Values: map[string]string{
			"URL": "postgres://${HOST}/db",
		},
		Globals: map[string]core.GlobalResolution{
			"HOST": {Kind: "runtime"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "postgres://${HOST}/db", result["URL"])
}

func TestExpandAll_Cycle(t *testing.T) {
	_, err := core.ExpandAll(core.ExpandInput{
		Values: map[string]string{
			"A": "${B}",
			"B": "${A}",
		},
		Globals: map[string]core.GlobalResolution{},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cycle")
}

func TestExpandAll_UnresolvedRef(t *testing.T) {
	_, err := core.ExpandAll(core.ExpandInput{
		Values:  map[string]string{"URL": "${GHOST}"},
		Globals: map[string]core.GlobalResolution{},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "GHOST")
}

// --- FindDependents ---

func TestFindDependents(t *testing.T) {
	records := []core.ValueRecord{
		{Variable: "OTHER", Vault: "local", Consumer: "api", Raw: "prefix_${TARGET}_suffix"},
		{Variable: "UNRELATED", Vault: "local", Consumer: "api", Raw: "plain"},
	}
	deps := core.FindDependents("TARGET", records)
	require.Len(t, deps, 1)
	assert.Equal(t, "OTHER", deps[0].Variable)
}

// --- Plan serialization security invariant ---

func TestVaultOpValueNotSerialized(t *testing.T) {
	op := core.VaultOp{
		Vault:  "local",
		Action: "set",
		Key:    "some-uuid",
		Value:  "supersecret",
	}
	data, err := json.Marshal(op)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "supersecret", "VaultOp.Value must never appear in JSON")
	assert.NotContains(t, string(data), "value", "VaultOp.Value field must be omitted from JSON")
}

// --- RenderPlanPretty ---

func TestRenderPlanPretty_Empty(t *testing.T) {
	assert.Equal(t, "no changes", core.RenderPlanPretty(core.EmptyPlan()))
}

func TestRenderPlanPretty_HasOps(t *testing.T) {
	plan := core.EmptyPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{Action: "set", Path: "variables.FOO", Summary: "define FOO"})
	plan.Vaults = append(plan.Vaults, core.VaultOp{Vault: "local", Action: "set", Key: "k1", Value: "hidden"})
	out := core.RenderPlanPretty(plan)
	assert.Contains(t, out, "variables.FOO")
	assert.Contains(t, out, "vault local: set k1")
	assert.NotContains(t, out, "hidden") // value never in pretty output
}
