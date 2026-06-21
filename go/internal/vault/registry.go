package vault

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/nikrabaev/menv/go/internal/core"
)

var providers = map[string]VaultProvider{}

// RegisterProvider registers a vault provider. Called from provider init()
// functions (e.g., internal/vault/local) so the vault package itself doesn't
// import any provider — the binary's main does, via blank import.
func RegisterProvider(p VaultProvider) {
	providers[p.Type()] = p
}

// KnownProviderTypes returns all registered provider type strings, sorted.
func KnownProviderTypes() []string {
	types := make([]string, 0, len(providers))
	for t := range providers {
		types = append(types, t)
	}
	sort.Strings(types)
	return types
}

// GetProvider returns the registered provider for the given type or an error.
func GetProvider(vaultType string) (VaultProvider, error) {
	p, ok := providers[vaultType]
	if !ok {
		known := KnownProviderTypes()
		return nil, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("unknown vaultType %q (known: %s)", vaultType, joinStr(known, ", ")),
		}
	}
	return p, nil
}

func joinStr(ss []string, sep string) string {
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}

// OpenSession resolves the provider for vaultType, parses its config, and
// returns an open session. config is the raw JSON from the registry VaultDef.
func OpenSession(vaultType string, config json.RawMessage, ctx VaultInitContext) (core.VaultSession, error) {
	p, err := GetProvider(vaultType)
	if err != nil {
		return nil, err
	}
	return p.Init(config, ctx)
}
