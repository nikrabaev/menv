package tui

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/nikrabaev/menv/go/internal/core"
	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// initWizard is shown when no menv.json exists. It picks the vault encryption
// mode and runs init, then hands off to the main UI.
type initWizard struct {
	form    *huh.Form
	encrypt *bool
	errText string
}

func newInitWizard() *initWizard {
	enc := true
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[bool]().
				Key("encrypt").
				Title("Initialize a menv repo").
				Description("Choose how the local vault stores values.").
				Options(
					huh.NewOption("Encrypted — age passphrase, committable ciphertext", true),
					huh.NewOption("Plaintext — git-ignored, no passphrase", false),
				).
				Value(&enc),
		),
	).WithShowHelp(true)
	return &initWizard{form: form, encrypt: &enc}
}

func (w *initWizard) Init() tea.Cmd { return w.form.Init() }

func (w *initWizard) Update(a *App, msg tea.Msg) tea.Cmd {
	if isKey(msg, "q") || isKey(msg, "ctrl+c") {
		return tea.Quit
	}
	model, cmd := w.form.Update(msg)
	if f, ok := model.(*huh.Form); ok {
		w.form = f
	}
	switch w.form.State {
	case huh.StateCompleted:
		created, err := runInitTUI(a.ctx.Root, *w.encrypt)
		if err != nil {
			// Rebuild the form so the user can retry, surfacing the error.
			nw := newInitWizard()
			w.form = nw.form
			w.encrypt = nw.encrypt
			w.errText = err.Error()
			return w.form.Init()
		}
		reg, lerr := registry.LoadRegistry(a.ctx.Root)
		if lerr != nil {
			w.errText = lerr.Error()
			return nil
		}
		a.loaded = true
		a.wizard = nil
		a.reg = reg
		a.activeVault = reg.Defaults.Vault
		a.busy = "loading"
		a.setStatus(statusOK, "initialized: "+strings.Join(created, ", "))
		return tea.Batch(a.loadVaultsCmd(), a.loadFindingsCmd(), a.loadBackupsCmd(), a.spinner.Tick)
	case huh.StateAborted:
		return tea.Quit
	}
	return cmd
}

func (w *initWizard) View(a *App) string {
	body := w.form.View()
	if w.errText != "" {
		body = a.style.blocker.Render(w.errText) + "\n\n" + body
	}
	box := a.style.modal.Render(a.style.modalTitle.Render("menv") + "\n\n" + body)
	return a.center(box)
}

// runInitTUI mirrors the CLI's init: write menv.json (schemaVersion 2, a single
// menv-local "local" vault) and the managed .gitignore block.
func runInitTUI(root string, encrypt bool) ([]string, error) {
	regPath := filepath.Join(root, registry.RegistryFilename)
	if _, err := os.Stat(regPath); err == nil {
		return nil, &core.MenvError{Code: core.ErrValidation, Message: registry.RegistryFilename + " already exists"}
	}
	if _, err := os.Stat(filepath.Join(root, "menv.toml")); err == nil {
		return nil, &core.MenvError{Code: core.ErrValidation, Message: "v1 repo detected (menv.toml) — remove the v1 files first"}
	}

	vaultCfg, _ := json.Marshal(map[string]any{"filename": ".menv/vault.json", "encryption": encrypt})
	reg := registry.Registry{
		SchemaVersion: 2,
		Defaults:      registry.Defaults{Vault: "local"},
		Vaults: map[string]registry.VaultDef{
			"local": {VaultType: "menv-local", VaultConfig: vaultCfg},
		},
		Consumers: map[string]registry.ConsumerDef{},
		Groups:    map[string]registry.GroupDef{},
		Globals:   map[string]registry.GlobalDef{},
		Variables: map[string]registry.VariableDef{},
		Compose:   registry.Compose{Files: []string{}},
	}
	if err := registry.SaveRegistry(root, reg); err != nil {
		return nil, err
	}
	ignores := []string{".menv/auth.local.json", ".menv/backups/"}
	if !encrypt {
		ignores = append(ignores, ".menv/vault.json")
	}
	if err := menvio.UpsertManagedBlock(root, ignores); err != nil {
		return nil, err
	}
	return []string{registry.RegistryFilename, ".gitignore (menv block)"}, nil
}
