package local_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/vault"
	_ "github.com/nikrabaev/menv/internal/vault/local"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func plainCtx(t *testing.T) (vault.VaultInitContext, json.RawMessage) {
	t.Helper()
	root := t.TempDir()
	cfg, _ := json.Marshal(map[string]any{"filename": ".menv/vault.json", "encryption": false})
	return vault.VaultInitContext{Root: root, Auth: vault.VaultAuth{}}, cfg
}

func encCtx(t *testing.T, passphrase string) (vault.VaultInitContext, json.RawMessage) {
	t.Helper()
	root := t.TempDir()
	cfg, _ := json.Marshal(map[string]any{"filename": ".menv/vault.json", "encryption": true})
	return vault.VaultInitContext{Root: root, Auth: vault.VaultAuth{Secret: passphrase, HasSecret: true}}, cfg
}

func openSession(t *testing.T, ctx vault.VaultInitContext, cfg json.RawMessage) core.VaultSession {
	t.Helper()
	p, err := vault.GetProvider("menv-local")
	require.NoError(t, err)
	sess, err := p.Init(cfg, ctx)
	require.NoError(t, err)
	return sess
}

// --- conformance suite (plain) ---

func TestPlain_GetMissingKey(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	_, found, err := sess.Get("nope")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestPlain_SetAndGet(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	require.NoError(t, sess.Set("FOO", "bar"))
	v, found, err := sess.Get("FOO")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "bar", v)
}

func TestPlain_Overwrite(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	require.NoError(t, sess.Set("K", "v1"))
	require.NoError(t, sess.Set("K", "v2"))
	v, _, _ := sess.Get("K")
	assert.Equal(t, "v2", v)
}

func TestPlain_Remove(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	require.NoError(t, sess.Set("K", "v"))
	require.NoError(t, sess.Remove("K"))
	_, found, _ := sess.Get("K")
	assert.False(t, found)
}

func TestPlain_RemoveMissing(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	// removing a missing key is a no-op — no error
	require.NoError(t, sess.Remove("ghost"))
}

func TestPlain_List(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	require.NoError(t, sess.Set("B", "2"))
	require.NoError(t, sess.Set("A", "1"))
	keys, err := sess.List()
	require.NoError(t, err)
	assert.Equal(t, []string{"A", "B"}, keys) // sorted
}

func TestPlain_ListEmpty(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	keys, err := sess.List()
	require.NoError(t, err)
	assert.Empty(t, keys)
}

func TestPlain_Persistence(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess1 := openSession(t, ctx, cfg)
	require.NoError(t, sess1.Set("HELLO", "world"))
	require.NoError(t, sess1.Close())

	// Open a new session against the same root — must see the persisted value.
	sess2 := openSession(t, ctx, cfg)
	v, found, err := sess2.Get("HELLO")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "world", v)
}

func TestPlain_StoredAsJSON(t *testing.T) {
	ctx, cfg := plainCtx(t)
	sess := openSession(t, ctx, cfg)
	require.NoError(t, sess.Set("KEY", "val"))

	data, err := os.ReadFile(filepath.Join(ctx.Root, ".menv/vault.json"))
	require.NoError(t, err)

	var parsed map[string]string
	require.NoError(t, json.Unmarshal(data, &parsed))
	assert.Equal(t, "val", parsed["KEY"])
}

// --- age encryption ---

func TestEncrypted_RoundTrip(t *testing.T) {
	ctx, cfg := encCtx(t, "my-passphrase")
	sess1 := openSession(t, ctx, cfg)
	require.NoError(t, sess1.Set("SECRET", "p@ssw0rd"))
	require.NoError(t, sess1.Close())

	// File on disk must not be plaintext JSON.
	data, err := os.ReadFile(filepath.Join(ctx.Root, ".menv/vault.json"))
	require.NoError(t, err)
	assert.NotContains(t, string(data), "p@ssw0rd", "plaintext must never appear in encrypted file")
	assert.NotContains(t, string(data), "SECRET", "key must not appear in encrypted file")

	// Re-open with correct passphrase — must see the value.
	sess2 := openSession(t, ctx, cfg)
	v, found, err := sess2.Get("SECRET")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "p@ssw0rd", v)
}

func TestEncrypted_WrongPassphrase(t *testing.T) {
	ctx, cfg := encCtx(t, "correct")
	sess := openSession(t, ctx, cfg)
	require.NoError(t, sess.Set("X", "y"))
	require.NoError(t, sess.Close())

	// Try opening with the wrong passphrase.
	wrongCfg, _ := json.Marshal(map[string]any{"filename": ".menv/vault.json", "encryption": true})
	wrongCtx := vault.VaultInitContext{Root: ctx.Root, Auth: vault.VaultAuth{Secret: "wrong", HasSecret: true}}
	p, _ := vault.GetProvider("menv-local")
	_, err := p.Init(wrongCfg, wrongCtx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AUTH_FAILED")
}

func TestEncrypted_NoPassphrase(t *testing.T) {
	_, cfg := encCtx(t, "some-pass")
	// Try opening encrypted vault without providing a passphrase.
	ctx := vault.VaultInitContext{Root: t.TempDir(), Auth: vault.VaultAuth{}}
	p, _ := vault.GetProvider("menv-local")
	_, err := p.Init(cfg, ctx)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AUTH_MISSING")
}

// --- provider registry ---

func TestGetProvider_Unknown(t *testing.T) {
	_, err := vault.GetProvider("does-not-exist")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "VALIDATION")
}

func TestGetProvider_LocalRegistered(t *testing.T) {
	p, err := vault.GetProvider("menv-local")
	require.NoError(t, err)
	assert.Equal(t, "menv-local", p.Type())
}

// --- config validation ---

func TestLocalProvider_MissingFilename(t *testing.T) {
	p, _ := vault.GetProvider("menv-local")
	cfg, _ := json.Marshal(map[string]any{"encryption": false})
	_, err := p.Init(cfg, vault.VaultInitContext{Root: t.TempDir()})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "filename")
}
