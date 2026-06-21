package tui

import (
	"github.com/charmbracelet/bubbletea"
	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/core/ops"
	"github.com/nikrabaev/menv/internal/generate"
	"github.com/nikrabaev/menv/internal/registry"
)

// applyOp executes a plan immediately (for cases without a confirmation modal).
// Returns a tea.Cmd that dispatches the result.
func applyOp(ctx *TuiContext, reg registry.Registry, op ops.OpResult) tea.Cmd {
	return func() tea.Msg {
		// Open sessions needed by the plan.
		sessions := map[string]core.VaultSession{}
		for _, vop := range op.Plan.Vaults {
			if _, ok := sessions[vop.Vault]; ok {
				continue
			}
			sess, err := OpenSession(ctx, reg, vop.Vault)
			if err != nil {
				return tuiErrMsg{err}
			}
			sessions[vop.Vault] = sess
		}
		defer func() {
			for _, s := range sessions {
				_ = s.Close()
			}
		}()

		err := core.ExecutePlan(op.Plan, core.ExecuteContext{
			Sessions: sessions,
			CommitRegistry: func() error {
				return registry.SaveRegistry(ctx.Root, op.Next)
			},
		})
		if err != nil {
			return tuiErrMsg{err}
		}
		return OpAppliedMsg{Reg: op.Next}
	}
}

// applyOpWithFileOps executes a plan that may include file operations.
func applyOpWithFileOps(ctx *TuiContext, reg registry.Registry, op ops.OpResult) tea.Cmd {
	return func() tea.Msg {
		sessions := map[string]core.VaultSession{}
		for _, vop := range op.Plan.Vaults {
			if _, ok := sessions[vop.Vault]; ok {
				continue
			}
			sess, err := OpenSession(ctx, reg, vop.Vault)
			if err != nil {
				return tuiErrMsg{err}
			}
			sessions[vop.Vault] = sess
		}
		defer func() {
			for _, s := range sessions {
				_ = s.Close()
			}
		}()

		err := core.ExecutePlan(op.Plan, core.ExecuteContext{
			Sessions: sessions,
			CommitRegistry: func() error {
				return registry.SaveRegistry(ctx.Root, op.Next)
			},
			ApplyFileOp: func(fop core.FileOp) error {
				return generate.ApplyFileOp(ctx.Root, fop)
			},
		})
		if err != nil {
			return tuiErrMsg{err}
		}
		return OpAppliedMsg{Reg: op.Next}
	}
}

// reloadVaults reloads all vault runtimes as a batch command.
func reloadVaults(ctx *TuiContext, reg registry.Registry) tea.Cmd {
	return func() tea.Msg {
		return AllVaultsMsg{Vaults: LoadAllVaults(ctx, reg)}
	}
}

// reloadFindings runs check in the background.
func reloadFindings(ctx *TuiContext, reg registry.Registry) tea.Cmd {
	return func() tea.Msg {
		return FindingsMsg{Findings: LoadFindings(ctx, reg)}
	}
}

// reloadRegistry re-reads menv.json from disk.
func reloadRegistry(ctx *TuiContext) tea.Cmd {
	return func() tea.Msg {
		reg, err := registry.LoadRegistry(ctx.Root)
		if err != nil {
			return tuiErrMsg{err}
		}
		return RegistryReloadedMsg{Reg: reg}
	}
}

// reloadBackups refreshes the backup list.
func reloadBackups(ctx *TuiContext) tea.Cmd {
	return func() tea.Msg {
		return BackupsMsg{Backups: LoadBackups(ctx)}
	}
}

// refreshAfterApply batches registry reload + vault reload + findings check.
func refreshAfterApply(ctx *TuiContext, reg registry.Registry) tea.Cmd {
	return tea.Batch(
		reloadVaults(ctx, reg),
		reloadFindings(ctx, reg),
	)
}

// tuiErrMsg wraps an error as a tea.Msg for the Update loop.
type tuiErrMsg struct{ err error }
