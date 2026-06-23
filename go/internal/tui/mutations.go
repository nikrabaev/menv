package tui

import (
	"sort"
	"strings"

	tea "charm.land/bubbletea/v2"

	"github.com/nikrabaev/menv/go/internal/cli"
	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/core/ops"
	"github.com/nikrabaev/menv/go/internal/generate"
	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// ── apply pipeline ──────────────────────────────────────────────────────────

// applyPlanCmd executes a plan in the background: open the vault sessions the
// plan needs, run ExecutePlan (vault ops → file ops → commit registry), then
// run an optional post-apply step (e.g. a .gitignore upsert).
func (a *App) applyPlanCmd(op ops.OpResult, force bool, label string, post func(root string) error) tea.Cmd {
	root := a.ctx.Root
	reg := a.reg
	flags := a.ctx.flags()
	flags.Force = force
	return func() tea.Msg {
		sessions := map[string]core.VaultSession{}
		defer func() {
			for _, s := range sessions {
				_ = s.Close()
			}
		}()
		for _, vop := range op.Plan.Vaults {
			if _, ok := sessions[vop.Vault]; ok {
				continue
			}
			sess, err := cli.OpenVaultSession(root, reg, vop.Vault, flags, nil)
			if err != nil {
				return appliedMsg{label: label, err: err}
			}
			sessions[vop.Vault] = sess
		}
		err := core.ExecutePlan(op.Plan, core.ExecuteContext{
			Force:    force,
			Sessions: sessions,
			CommitRegistry: func() error {
				return registry.SaveRegistry(root, op.Next)
			},
			ApplyFileOp: func(fop core.FileOp) error {
				return generate.ApplyFileOp(root, fop)
			},
		})
		if err == nil && post != nil {
			err = post(root)
		}
		return appliedMsg{label: label, err: err}
	}
}

// pushPlan opens the plan-confirm modal, or short-circuits to a status message
// when the plan is a no-op.
func (a *App) pushPlan(title, label string, op ops.OpResult) tea.Cmd {
	return a.pushPlanPost(title, label, op, nil)
}

// pushPlanPost is pushPlan with a post-apply side effect (e.g. .gitignore).
func (a *App) pushPlanPost(title, label string, op ops.OpResult, post func(root string) error) tea.Cmd {
	p := op.Plan
	if len(p.Registry)+len(p.Vaults)+len(p.Files)+len(p.Blockers)+len(p.Warnings) == 0 {
		a.setStatus(statusInfo, "no changes")
		return nil
	}
	return a.pushModal(&planConfirmModal{title: title, label: label, op: op, post: post})
}

// refreshAfterApply reloads registry + backups (which cascades to vaults +
// findings via registryReloadedMsg).
func (a *App) refreshAfterApply() tea.Cmd {
	return tea.Batch(a.reloadRegistryCmd(), a.loadBackupsCmd())
}

// ── ensureUnlocked / withConsumer ───────────────────────────────────────────

// ensureUnlocked runs cont immediately if the vault is unlocked, otherwise
// pushes an unlock modal whose success continuation is cont.
func (a *App) ensureUnlocked(vault string, cont func(a *App) tea.Cmd) tea.Cmd {
	if a.vaultUnlocked(vault) {
		return cont(a)
	}
	return a.pushModal(a.newUnlockModal(vault, cont))
}

// withConsumer resolves the consumer for a value-level action on a variable in
// the active vault. Unambiguous cases run cont directly; otherwise a picker.
func (a *App) withConsumer(name, preset string, cont func(a *App, consumer string) tea.Cmd) tea.Cmd {
	def, ok := a.reg.Variables[name]
	if !ok {
		a.setStatus(statusErr, "unknown variable")
		return nil
	}
	mapping := def.VaultMapping[a.activeVault]
	if len(mapping) == 0 {
		a.setStatus(statusErr, name+" is not wired in "+a.activeVault)
		return nil
	}
	if preset != "" {
		if _, ok := mapping[preset]; ok {
			return cont(a, preset)
		}
	}
	keys := map[string]bool{}
	var consumers []string
	for c, e := range mapping {
		keys[e.Key] = true
		consumers = append(consumers, c)
	}
	sort.Strings(consumers)
	if len(keys) == 1 {
		return cont(a, consumers[0])
	}
	return a.pushModal(a.newConsumerPickModal(consumers, cont))
}

// scanFromRuntime builds a ValueScan from the in-memory vault snapshots — no
// I/O, so orphan/dependency detection never blocks the UI. Locked vaults are
// reported as unverified, matching the CLI's openable semantics.
func (a *App) scanFromRuntime(vaults []string) cli.ValueScan {
	records := []core.ValueRecord{}
	var unverified []string
	openable := map[string]bool{}
	seen := map[string]bool{}
	for _, v := range vaults {
		if seen[v] {
			continue
		}
		seen[v] = true
		rt := a.vaults[v]
		if rt == nil || !rt.unlocked {
			unverified = append(unverified, v)
			continue
		}
		openable[v] = true
		for varName, def := range a.reg.Variables {
			for consumer, entry := range def.VaultMapping[v] {
				if val, ok := rt.values[entry.Key]; ok {
					records = append(records, core.ValueRecord{
						Variable: varName, Vault: v, Consumer: consumer, Raw: val,
					})
				}
			}
		}
	}
	sort.Strings(unverified)
	return cli.ValueScan{Records: records, Unverified: unverified, Openable: openable}
}

// vaultsWiringVariable returns every vault a variable is mapped in.
func (a *App) vaultsWiringVariable(name string) []string {
	def := a.reg.Variables[name]
	set := map[string]bool{}
	for v := range def.VaultMapping {
		set[v] = true
	}
	return sortedStrings(set)
}

// vaultsWiringConsumer returns every vault a consumer is wired in.
func (a *App) vaultsWiringConsumer(consumer string) []string {
	set := map[string]bool{}
	for _, def := range a.reg.Variables {
		for v, byConsumer := range def.VaultMapping {
			if _, ok := byConsumer[consumer]; ok {
				set[v] = true
			}
		}
	}
	return sortedStrings(set)
}

// ── check / generate ────────────────────────────────────────────────────────

func (a *App) checkCmd() tea.Cmd {
	root := a.ctx.Root
	reg := a.reg
	flags := cli.MutationFlags{VaultAuth: a.ctx.authCopy(), Mode: cli.ModePretty}
	return func() tea.Msg {
		f, err := cli.CollectFindings(root, reg, flags)
		return findingsMsg{findings: f, err: err, openModal: true}
	}
}

func (a *App) generateFlow() tea.Cmd {
	return a.ensureUnlocked(a.activeVault, func(a *App) tea.Cmd {
		cmd := a.pushModal(&generateModal{phase: genLoading})
		return tea.Batch(cmd, a.spinner.Tick, a.genPreviewCmd())
	})
}

func (a *App) genPreviewCmd() tea.Cmd {
	root := a.ctx.Root
	reg := a.reg
	flags := a.ctx.flags()
	vault := a.activeVault
	return func() tea.Msg {
		opts := generate.GenerateOpts{Vault: vault}
		sessions := map[string]core.VaultSession{}
		defer func() {
			for _, s := range sessions {
				_ = s.Close()
			}
		}()
		for _, v := range generate.VaultsNeeded(reg, opts) {
			sess, err := cli.OpenVaultSession(root, reg, v, flags, nil)
			if err != nil {
				return genPreviewMsg{err: err}
			}
			sessions[v] = sess
		}
		runCompose := len(reg.Compose.Files) > 0
		if runCompose {
			if _, ok := sessions[vault]; !ok {
				sess, err := cli.OpenVaultSession(root, reg, vault, flags, nil)
				if err != nil {
					return genPreviewMsg{err: err}
				}
				sessions[vault] = sess
			}
		}
		env, err := generate.PreviewGenerate(root, reg, opts, sessions)
		if err != nil {
			return genPreviewMsg{err: err}
		}
		var all []writeOp
		for _, w := range env.Writes {
			all = append(all, writeOp{path: w.Path, content: w.Content})
		}
		warnings := env.Warnings
		if runCompose {
			cp, err := generate.PreviewCompose(root, reg, opts, sessions)
			if err != nil {
				return genPreviewMsg{err: err}
			}
			if len(cp.Errors) > 0 {
				msgs := make([]string, len(cp.Errors))
				for i, e := range cp.Errors {
					msgs[i] = e.Message
				}
				return genPreviewMsg{err: &core.MenvError{Code: core.ErrValidation, Message: "compose: " + strings.Join(msgs, "; ")}}
			}
			for _, w := range cp.Writes {
				all = append(all, writeOp{path: w.Path, content: w.Content})
			}
			warnings = append(warnings, cp.Warnings...)
		}
		paths := make([]string, len(all))
		for i, w := range all {
			paths[i] = w.path
		}
		return genPreviewMsg{preview: generatePreview{
			writes:    paths,
			unchanged: env.Unchanged,
			refused:   env.Refused,
			warnings:  warnings,
			allWrites: all,
		}}
	}
}

func (a *App) genApplyCmd(p generatePreview) tea.Cmd {
	root := a.ctx.Root
	return func() tea.Msg {
		writes := make([]generate.FileWrite, len(p.allWrites))
		for i, w := range p.allWrites {
			writes[i] = generate.FileWrite{Path: w.path, Content: w.content}
		}
		err := generate.ApplyPreview(root, generate.GeneratePreview{Writes: writes})
		return genAppliedMsg{count: len(writes), err: err}
	}
}

// ── backups ─────────────────────────────────────────────────────────────────

func (a *App) createBackupCmd() tea.Cmd {
	root := a.ctx.Root
	reg := a.reg
	return func() tea.Msg {
		key, paths, err := makeBackup(root, reg)
		return backupCreatedMsg{key: key, count: len(paths), err: err}
	}
}

func (a *App) restoreBackupCmd(key string) tea.Cmd {
	root := a.ctx.Root
	return func() tea.Msg {
		restored, err := menvio.RestoreBackup(root, key)
		return restoredMsg{count: len(restored), err: err}
	}
}
