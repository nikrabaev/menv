package vault_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/nikrabaev/menv/internal/vault"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAuthEnvVarName(t *testing.T) {
	assert.Equal(t, "MENV_VAULT_AUTH_LOCAL", vault.AuthEnvVarName("local"))
	assert.Equal(t, "MENV_VAULT_AUTH_PROD", vault.AuthEnvVarName("prod"))
	assert.Equal(t, "MENV_VAULT_AUTH_MY_VAULT", vault.AuthEnvVarName("my-vault"))
	assert.Equal(t, "MENV_VAULT_AUTH_MY_VAULT", vault.AuthEnvVarName("my.vault"))
}

func writeAuthFile(t *testing.T, root string, content map[string]any) {
	t.Helper()
	dir := filepath.Join(root, ".menv")
	require.NoError(t, os.MkdirAll(dir, 0700))
	data, err := json.Marshal(content)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "auth.local.json"), data, 0600))
}

func TestResolveVaultAuth_Flag(t *testing.T) {
	tmp := t.TempDir()
	auth, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root:    tmp,
		Flag:    "from-flag",
		FlagSet: true,
		Env:     map[string]string{},
	})
	require.NoError(t, err)
	assert.Equal(t, "from-flag", auth.Secret)
	assert.True(t, auth.HasSecret)
}

func TestResolveVaultAuth_EnvVar(t *testing.T) {
	tmp := t.TempDir()
	auth, err := vault.ResolveVaultAuth("local", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{"MENV_VAULT_AUTH_LOCAL": "from-env"},
	})
	require.NoError(t, err)
	assert.Equal(t, "from-env", auth.Secret)
}

func TestResolveVaultAuth_AuthFileValue(t *testing.T) {
	tmp := t.TempDir()
	writeAuthFile(t, tmp, map[string]any{
		"myvault": map[string]any{"type": "value", "value": "from-file"},
	})
	auth, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{},
	})
	require.NoError(t, err)
	assert.Equal(t, "from-file", auth.Secret)
}

func TestResolveVaultAuth_AuthFileEnv(t *testing.T) {
	tmp := t.TempDir()
	writeAuthFile(t, tmp, map[string]any{
		"myvault": map[string]any{"type": "env", "name": "MY_SECRET"},
	})
	auth, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{"MY_SECRET": "from-env-ref"},
	})
	require.NoError(t, err)
	assert.Equal(t, "from-env-ref", auth.Secret)
}

func TestResolveVaultAuth_AuthFileEnvMissing(t *testing.T) {
	tmp := t.TempDir()
	writeAuthFile(t, tmp, map[string]any{
		"myvault": map[string]any{"type": "env", "name": "NOT_SET"},
	})
	_, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "NOT_SET")
}

func TestResolveVaultAuth_AuthFileCommand(t *testing.T) {
	tmp := t.TempDir()
	writeAuthFile(t, tmp, map[string]any{
		"myvault": map[string]any{"type": "command", "command": "echo secret123"},
	})
	auth, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{},
	})
	require.NoError(t, err)
	assert.Equal(t, "secret123", auth.Secret)
}

func TestResolveVaultAuth_AuthFileCommandFailed(t *testing.T) {
	tmp := t.TempDir()
	writeAuthFile(t, tmp, map[string]any{
		"myvault": map[string]any{"type": "command", "command": "exit 1"},
	})
	_, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed")
}

func TestResolveVaultAuth_Prompt(t *testing.T) {
	tmp := t.TempDir()
	auth, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{},
		PromptFn: func(name string) (string, error) {
			assert.Equal(t, "myvault", name)
			return "prompted-secret", nil
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "prompted-secret", auth.Secret)
}

func TestResolveVaultAuth_NoAuthError(t *testing.T) {
	tmp := t.TempDir()
	_, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "myvault")
	assert.Contains(t, err.Error(), "AUTH_MISSING")
}

func TestResolveVaultAuth_FlagTakesPriority(t *testing.T) {
	tmp := t.TempDir()
	writeAuthFile(t, tmp, map[string]any{
		"myvault": map[string]any{"type": "value", "value": "from-file"},
	})
	auth, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root:    tmp,
		Flag:    "from-flag",
		FlagSet: true,
		Env:     map[string]string{"MENV_VAULT_AUTH_MYVAULT": "from-env"},
	})
	require.NoError(t, err)
	assert.Equal(t, "from-flag", auth.Secret)
}

func TestResolveVaultAuth_NoAuthFile(t *testing.T) {
	tmp := t.TempDir()
	// auth.local.json doesn't exist — should fall through to prompt or error
	_, err := vault.ResolveVaultAuth("myvault", vault.ResolveAuthOptions{
		Root: tmp,
		Env:  map[string]string{},
	})
	require.Error(t, err)
}

func TestResolveVaultAuthOptional_NoAuth(t *testing.T) {
	tmp := t.TempDir()
	auth, err := vault.ResolveVaultAuthOptional("myvault", tmp, map[string]string{})
	require.NoError(t, err)
	assert.False(t, auth.HasSecret)
}

func TestResolveVaultAuthOptional_EnvSet(t *testing.T) {
	tmp := t.TempDir()
	auth, err := vault.ResolveVaultAuthOptional("local", tmp, map[string]string{"MENV_VAULT_AUTH_LOCAL": "mysecret"})
	require.NoError(t, err)
	assert.True(t, auth.HasSecret)
	assert.Equal(t, "mysecret", auth.Secret)
}
