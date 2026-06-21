package vault

import (
	"encoding/json"

	"github.com/nikrabaev/menv/internal/core"
)

// VaultAuth is the resolved auth material for one vault. Interpretation is
// provider-specific: menv-local uses secret as the age passphrase.
type VaultAuth struct {
	Secret string // empty means no auth supplied
	HasSecret bool // distinguishes "no auth" from empty-string passphrase
}

// VaultInitContext is passed to VaultProvider.Init.
type VaultInitContext struct {
	Root string    // repo root — providers resolve relative paths against this
	Auth VaultAuth
}

// VaultProvider is the plugin contract for vault backends.
type VaultProvider interface {
	Type() string
	// Init parses config (provider-specific JSON) and returns a ready session.
	// config is json.RawMessage so each provider controls its own schema.
	Init(config json.RawMessage, ctx VaultInitContext) (core.VaultSession, error)
}
