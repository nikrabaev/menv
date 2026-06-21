package tui

import (
	tea "charm.land/bubbletea/v2"

	"github.com/nikrabaev/menv/go/internal/cli"
	"github.com/nikrabaev/menv/go/internal/core"
	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// ── async messages ──────────────────────────────────────────────────────────

type vaultsLoadedMsg struct{ runtimes map[string]*vaultRuntime }

type findingsMsg struct {
	findings  []cli.Finding
	err       error
	openModal bool // when true, open the findings modal on receipt
}

type backupsMsg struct{ keys []string }

type registryReloadedMsg struct {
	reg registry.Registry
	err error
}

// unlockResultMsg reports the outcome of an attempted vault unlock.
type unlockResultMsg struct {
	vault  string
	secret string
	values map[string]string
	ok     bool
	err    error
}

// appliedMsg reports the outcome of executing a plan.
type appliedMsg struct {
	label string // human label, e.g. "applied", "wired DATABASE_URL"
	err   error
}

// genPreviewMsg / genAppliedMsg drive the generate modal.
type genPreviewMsg struct {
	preview generatePreview
	err     error
}

type genAppliedMsg struct {
	count int
	err   error
}

// snapshot of a generate preview the modal renders.
type generatePreview struct {
	writes    []string
	unchanged []string
	refused   []string
	warnings  []core.PlanIssue
	allWrites []writeOp // path+content, kept for apply
}

type writeOp struct {
	path    string
	content string
}

// backupCreatedMsg / restoredMsg report backup operations.
type backupCreatedMsg struct {
	key   string
	count int
	err   error
}

type restoredMsg struct {
	count int
	err   error
}

// statusOnlyMsg lets a Cmd set a transient status without other side effects.
type statusOnlyMsg struct {
	kind statusKind
	text string
}

// ── loaders ─────────────────────────────────────────────────────────────────

// readVault opens a vault read-only and snapshots its values, degrading to a
// locked runtime when it cannot be opened.
func readVault(root string, reg registry.Registry, name string, auth map[string]string) *vaultRuntime {
	flags := cli.MutationFlags{VaultAuth: auth, Mode: cli.ModePretty}
	sess, err := cli.OpenVaultSession(root, reg, name, flags, nil)
	if err != nil {
		return &vaultRuntime{unlocked: false}
	}
	defer sess.Close()
	vals := map[string]string{}
	if keys, e := sess.List(); e == nil {
		for _, k := range keys {
			if v, ok, _ := sess.Get(k); ok {
				vals[k] = v
			}
		}
	}
	return &vaultRuntime{unlocked: true, values: vals}
}

func (a *App) loadVaultsCmd() tea.Cmd {
	root := a.ctx.Root
	reg := a.reg
	auth := a.ctx.authCopy()
	return func() tea.Msg {
		runtimes := map[string]*vaultRuntime{}
		for name := range reg.Vaults {
			runtimes[name] = readVault(root, reg, name, auth)
		}
		return vaultsLoadedMsg{runtimes: runtimes}
	}
}

func (a *App) loadFindingsCmd() tea.Cmd {
	root := a.ctx.Root
	reg := a.reg
	flags := cli.MutationFlags{VaultAuth: a.ctx.authCopy(), Mode: cli.ModePretty}
	return func() tea.Msg {
		f, err := cli.CollectFindings(root, reg, flags)
		return findingsMsg{findings: f, err: err}
	}
}

func (a *App) loadBackupsCmd() tea.Cmd {
	root := a.ctx.Root
	return func() tea.Msg {
		keys, _ := menvio.ListBackups(root)
		return backupsMsg{keys: keys}
	}
}

func (a *App) reloadRegistryCmd() tea.Cmd {
	root := a.ctx.Root
	return func() tea.Msg {
		reg, err := registry.LoadRegistry(root)
		return registryReloadedMsg{reg: reg, err: err}
	}
}

// tryUnlockCmd attempts to open a vault with secret (scrypt is deliberately
// slow, hence a background Cmd) and snapshots its values on success.
func (a *App) tryUnlockCmd(vault, secret string) tea.Cmd {
	root := a.ctx.Root
	reg := a.reg
	flags := cli.MutationFlags{VaultAuth: map[string]string{vault: secret}, Mode: cli.ModePretty}
	return func() tea.Msg {
		sess, err := cli.OpenVaultSession(root, reg, vault, flags, nil)
		if err != nil {
			return unlockResultMsg{vault: vault, ok: false, err: err}
		}
		defer sess.Close()
		vals := map[string]string{}
		if keys, e := sess.List(); e == nil {
			for _, k := range keys {
				if v, ok, _ := sess.Get(k); ok {
					vals[k] = v
				}
			}
		}
		return unlockResultMsg{vault: vault, secret: secret, values: vals, ok: true}
	}
}
