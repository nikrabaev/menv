package vault

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/nikrabaev/menv/internal/core"
)

const AuthFileRel = ".menv/auth.local.json"

// authFileEntry is a per-machine vault auth hook.
type authFileEntry struct {
	Type    string // "value" | "env" | "command"
	Value   string // for type=value
	Name    string // for type=env
	Command string // for type=command
}

// AuthEnvVarName returns the environment variable name for a vault's auth.
func AuthEnvVarName(vault string) string {
	upper := strings.ToUpper(vault)
	var b strings.Builder
	b.WriteString("MENV_VAULT_AUTH_")
	for _, ch := range upper {
		if (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') {
			b.WriteRune(ch)
		} else {
			b.WriteRune('_')
		}
	}
	return b.String()
}

func readAuthFileEntry(root, vault string) (*authFileEntry, error) {
	path := filepath.Join(root, AuthFileRel)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, &core.MenvError{Code: core.ErrVaultIO, Message: fmt.Sprintf("could not read %s: %v", AuthFileRel, err)}
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, &core.MenvError{Code: core.ErrParse, Message: AuthFileRel + " is not valid JSON"}
	}
	entryRaw, ok := raw[vault]
	if !ok {
		return nil, nil
	}
	var entry struct {
		Type    string `json:"type"`
		Value   string `json:"value"`
		Name    string `json:"name"`
		Command string `json:"command"`
	}
	if err := json.Unmarshal(entryRaw, &entry); err != nil {
		return nil, &core.MenvError{Code: core.ErrParse, Message: fmt.Sprintf("%s: entry for %q is not valid JSON", AuthFileRel, vault)}
	}
	switch entry.Type {
	case "value":
		if entry.Value == "" {
			return nil, &core.MenvError{Code: core.ErrParse, Message: fmt.Sprintf(`%s: entry for %q must have a non-empty "value"`, AuthFileRel, vault)}
		}
		return &authFileEntry{Type: "value", Value: entry.Value}, nil
	case "env":
		if entry.Name == "" {
			return nil, &core.MenvError{Code: core.ErrParse, Message: fmt.Sprintf(`%s: entry for %q must have a non-empty "name"`, AuthFileRel, vault)}
		}
		return &authFileEntry{Type: "env", Name: entry.Name}, nil
	case "command":
		if entry.Command == "" {
			return nil, &core.MenvError{Code: core.ErrParse, Message: fmt.Sprintf(`%s: entry for %q must have a non-empty "command"`, AuthFileRel, vault)}
		}
		return &authFileEntry{Type: "command", Command: entry.Command}, nil
	default:
		return nil, &core.MenvError{Code: core.ErrParse, Message: fmt.Sprintf(`%s: entry for %q must have type "value", "env", or "command"`, AuthFileRel, vault)}
	}
}

func runAuthCommand(vault, command string) (string, error) {
	out, err := exec.Command("sh", "-c", command).Output()
	if err != nil {
		var msg string
		if ee, ok := err.(*exec.ExitError); ok {
			msg = strings.TrimSpace(string(ee.Stderr))
		}
		if msg == "" {
			msg = command
		}
		return "", &core.MenvError{Code: core.ErrAuthFailed, Message: fmt.Sprintf("auth command for vault %q failed: %s", vault, msg)}
	}
	return strings.TrimSpace(string(out)), nil
}

// ResolveAuthOptions holds the parameters for auth resolution.
type ResolveAuthOptions struct {
	Root     string
	Flag     string // from --vault-auth <vault>=<secret>; empty = not provided
	FlagSet  bool   // distinguishes "flag not given" from empty flag value
	Env      map[string]string
	PromptFn func(vaultName string) (string, error) // nil = no TTY prompt
}

// ResolveVaultAuth resolves auth via: flag → env → auth file → prompt → error.
func ResolveVaultAuth(vault string, opts ResolveAuthOptions) (VaultAuth, error) {
	if opts.FlagSet {
		return VaultAuth{Secret: opts.Flag, HasSecret: true}, nil
	}
	envVar := AuthEnvVarName(vault)
	if v, ok := opts.Env[envVar]; ok {
		return VaultAuth{Secret: v, HasSecret: true}, nil
	}
	entry, err := readAuthFileEntry(opts.Root, vault)
	if err != nil {
		return VaultAuth{}, err
	}
	if entry != nil {
		switch entry.Type {
		case "value":
			return VaultAuth{Secret: entry.Value, HasSecret: true}, nil
		case "env":
			v, ok := opts.Env[entry.Name]
			if !ok {
				return VaultAuth{}, &core.MenvError{
					Code:    core.ErrAuthFailed,
					Message: fmt.Sprintf(`%s: %q points at unset env var %s`, AuthFileRel, vault, entry.Name),
				}
			}
			return VaultAuth{Secret: v, HasSecret: true}, nil
		case "command":
			secret, err := runAuthCommand(vault, entry.Command)
			if err != nil {
				return VaultAuth{}, err
			}
			return VaultAuth{Secret: secret, HasSecret: true}, nil
		}
	}
	if opts.PromptFn != nil {
		secret, err := opts.PromptFn(vault)
		if err != nil {
			return VaultAuth{}, err
		}
		return VaultAuth{Secret: secret, HasSecret: true}, nil
	}
	return VaultAuth{}, &core.MenvError{
		Code: core.ErrAuthMissing,
		Message: fmt.Sprintf(
			"no auth for vault %q. Supply it via --vault-auth %s=…, the %s env var, a %q entry in %s, or run on a TTY to be prompted.",
			vault, vault, AuthEnvVarName(vault), vault, AuthFileRel,
		),
	}
}

// ResolveVaultAuthOptional resolves auth without prompting; returns empty
// VaultAuth (HasSecret=false) when nothing is configured — never returns
// AUTH_MISSING. The CLI uses this before opening vaults that may not need
// auth (plaintext menv-local); if Init raises AUTH_MISSING the caller prompts.
func ResolveVaultAuthOptional(vaultName string, root string, env map[string]string) (VaultAuth, error) {
	envVar := AuthEnvVarName(vaultName)
	if v, ok := env[envVar]; ok {
		return VaultAuth{Secret: v, HasSecret: true}, nil
	}
	entry, err := readAuthFileEntry(root, vaultName)
	if err != nil {
		return VaultAuth{}, err
	}
	if entry != nil {
		switch entry.Type {
		case "value":
			return VaultAuth{Secret: entry.Value, HasSecret: true}, nil
		case "env":
			v, ok := env[entry.Name]
			if !ok {
				return VaultAuth{}, &core.MenvError{
					Code:    core.ErrAuthFailed,
					Message: fmt.Sprintf(`%s: %q points at unset env var %s`, AuthFileRel, vaultName, entry.Name),
				}
			}
			return VaultAuth{Secret: v, HasSecret: true}, nil
		case "command":
			secret, err := runAuthCommand(vaultName, entry.Command)
			if err != nil {
				return VaultAuth{}, err
			}
			return VaultAuth{Secret: secret, HasSecret: true}, nil
		}
	}
	return VaultAuth{}, nil
}
