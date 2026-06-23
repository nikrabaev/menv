package registry

import "encoding/json"

// The shape of menv.json (schemaVersion 2). The registry never contains a
// value: values live in vaults, addressed by the keys in vaultMapping.

type VaultName = string
type ConsumerName = string
type GroupKey = string
type VariableName = string

type VaultDef struct {
	VaultType string `json:"vaultType"`
	// Provider-specific config; parsed and validated by the provider on Init.
	VaultConfig json.RawMessage `json:"vaultConfig"`
}

// StrategyConfig holds the fields for both "single" and "per-vault" strategies.
// Only the relevant fields are populated; the validator enforces consistency.
type StrategyConfig struct {
	BaseDir                 string            `json:"baseDir"`
	Filename                string            `json:"filename,omitempty"`  // single strategy
	Filenames               map[string]string `json:"filenames,omitempty"` // per-vault strategy
	SecretsAsLocalOverrides bool              `json:"secretsAsLocalOverrides,omitempty"`
	Example                 bool              `json:"example,omitempty"`
}

type ConsumerDef struct {
	StrategyType   string         `json:"strategyType"` // "single" | "per-vault"
	StrategyConfig StrategyConfig `json:"strategyConfig"`
}

type GroupDef struct {
	Title string `json:"title"`
}

type GlobalValueDef struct {
	Source string `json:"source"`          // "runtime" | "static"
	Value  string `json:"value,omitempty"` // only set when source == "static"
}

type GlobalDef struct {
	Description string                    `json:"description,omitempty"`
	Values      map[VaultName]GlobalValueDef `json:"values"`
}

type MappingEntry struct {
	Key      string `json:"key"`
	Disabled bool   `json:"disabled,omitempty"`
}

type VariableDef struct {
	GroupKey     string                                       `json:"groupKey,omitempty"`
	Secret       bool                                         `json:"secret,omitempty"`
	Description  string                                       `json:"description,omitempty"`
	Example      string                                       `json:"example,omitempty"`
	VaultMapping map[VaultName]map[ConsumerName]MappingEntry  `json:"vaultMapping"`
}

type Defaults struct {
	Vault VaultName `json:"vault"`
}

type Compose struct {
	Files []string `json:"files"`
}

type Registry struct {
	SchemaVersion int                           `json:"schemaVersion"`
	Defaults      Defaults                      `json:"defaults"`
	Vaults        map[VaultName]VaultDef        `json:"vaults"`
	Consumers     map[ConsumerName]ConsumerDef  `json:"consumers"`
	Groups        map[GroupKey]GroupDef         `json:"groups"`
	Globals       map[string]GlobalDef          `json:"globals"`
	Variables     map[VariableName]VariableDef  `json:"variables"`
	Compose       Compose                       `json:"compose"`
}
