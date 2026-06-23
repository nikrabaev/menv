package local

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"filippo.io/age"
	"github.com/nikrabaev/menv/go/internal/core"
	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/nikrabaev/menv/go/internal/vault"
)

func init() {
	vault.RegisterProvider(Provider)
}

type localConfig struct {
	Filename   string `json:"filename"`
	Encryption bool   `json:"encryption"`
}

func parseConfig(raw json.RawMessage) (localConfig, error) {
	var cfg localConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return localConfig{}, &core.MenvError{Code: core.ErrValidation, Message: "menv-local: vaultConfig is not valid JSON"}
	}
	if cfg.Filename == "" {
		return localConfig{}, &core.MenvError{Code: core.ErrValidation, Message: "menv-local: vaultConfig.filename must be a non-empty string"}
	}
	return cfg, nil
}

func parseStore(data []byte, filename string) (map[string]string, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, &core.MenvError{Code: core.ErrVaultIO, Message: fmt.Sprintf("menv-local: %s is not valid JSON", filename)}
	}
	store := make(map[string]string, len(raw))
	for k, v := range raw {
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, &core.MenvError{Code: core.ErrVaultIO, Message: fmt.Sprintf("menv-local: %s key %q holds a non-string value", filename, k)}
		}
		store[k] = s
	}
	return store, nil
}

func decryptAge(data []byte, passphrase string) ([]byte, error) {
	identity, err := age.NewScryptIdentity(passphrase)
	if err != nil {
		return nil, err
	}
	r, err := age.Decrypt(bytes.NewReader(data), identity)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func encryptAge(plaintext []byte, passphrase string) ([]byte, error) {
	recipient, err := age.NewScryptRecipient(passphrase)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	w, err := age.Encrypt(&buf, recipient)
	if err != nil {
		return nil, err
	}
	if _, err := w.Write(plaintext); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func loadStore(cfg localConfig, ctx vault.VaultInitContext) (map[string]string, error) {
	path := filepath.Join(ctx.Root, cfg.Filename)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, &core.MenvError{Code: core.ErrVaultIO, Message: fmt.Sprintf("menv-local: could not read %s: %v", cfg.Filename, err)}
	}
	if cfg.Encryption {
		plain, err := decryptAge(data, ctx.Auth.Secret)
		if err != nil {
			return nil, &core.MenvError{Code: core.ErrAuthFailed, Message: fmt.Sprintf("menv-local: could not decrypt %s (wrong key?)", cfg.Filename)}
		}
		return parseStore(plain, cfg.Filename)
	}
	return parseStore(data, cfg.Filename)
}

func persistStore(cfg localConfig, ctx vault.VaultInitContext, store map[string]string) error {
	// Serialize to pretty JSON with sorted keys for deterministic output.
	keys := make([]string, 0, len(store))
	for k := range store {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	ordered := make([]byte, 0, 256)
	ordered = append(ordered, '{')
	for i, k := range keys {
		if i > 0 {
			ordered = append(ordered, ',')
		}
		kj, _ := json.Marshal(k)
		vj, _ := json.Marshal(store[k])
		ordered = append(ordered, '\n', ' ', ' ')
		ordered = append(ordered, kj...)
		ordered = append(ordered, ':', ' ')
		ordered = append(ordered, vj...)
	}
	if len(keys) > 0 {
		ordered = append(ordered, '\n')
	}
	ordered = append(ordered, '}', '\n')

	var payload []byte
	if cfg.Encryption {
		enc, err := encryptAge(ordered, ctx.Auth.Secret)
		if err != nil {
			return &core.MenvError{Code: core.ErrVaultIO, Message: fmt.Sprintf("menv-local: could not encrypt %s: %v", cfg.Filename, err)}
		}
		payload = enc
	} else {
		payload = ordered
	}
	if err := menvio.WriteFileAtomic(ctx.Root, cfg.Filename, payload); err != nil {
		return &core.MenvError{Code: core.ErrVaultIO, Message: fmt.Sprintf("menv-local: could not write %s: %v", cfg.Filename, err)}
	}
	return nil
}

type session struct {
	cfg   localConfig
	ctx   vault.VaultInitContext
	store map[string]string
}

func (s *session) Get(key string) (string, bool, error) {
	v, ok := s.store[key]
	return v, ok, nil
}

func (s *session) Set(key, value string) error {
	prev, had := s.store[key]
	s.store[key] = value
	if err := persistStore(s.cfg, s.ctx, s.store); err != nil {
		if had {
			s.store[key] = prev
		} else {
			delete(s.store, key)
		}
		return err
	}
	return nil
}

func (s *session) Remove(key string) error {
	prev, ok := s.store[key]
	if !ok {
		return nil // removing a missing key is a no-op
	}
	delete(s.store, key)
	if err := persistStore(s.cfg, s.ctx, s.store); err != nil {
		s.store[key] = prev // rollback
		return err
	}
	return nil
}

func (s *session) List() ([]string, error) {
	keys := make([]string, 0, len(s.store))
	for k := range s.store {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys, nil
}

func (s *session) Close() error { return nil }

// Provider is the menv-local vault provider.
var Provider vault.VaultProvider = &localProvider{}

type localProvider struct{}

func (localProvider) Type() string { return "menv-local" }

func (localProvider) Init(config json.RawMessage, ctx vault.VaultInitContext) (core.VaultSession, error) {
	cfg, err := parseConfig(config)
	if err != nil {
		return nil, err
	}
	if cfg.Encryption && !ctx.Auth.HasSecret {
		return nil, &core.MenvError{
			Code:    core.ErrAuthMissing,
			Message: fmt.Sprintf("menv-local: %s is encrypted and no key was provided", cfg.Filename),
		}
	}
	store, err := loadStore(cfg, ctx)
	if err != nil {
		return nil, err
	}
	return &session{cfg: cfg, ctx: ctx, store: store}, nil
}
