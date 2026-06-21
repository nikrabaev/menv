package tui

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/nikrabaev/menv/internal/registry"
)

// AppModel is the root bubbletea model.
type AppModel struct {
	ctx   *TuiContext
	state AppState
}

// NewAppModel constructs an AppModel from the given registry.
func NewAppModel(ctx *TuiContext, reg registry.Registry) AppModel {
	return AppModel{
		ctx:   ctx,
		state: newAppState(reg, ""),
	}
}

// Init loads all vaults and backups on startup.
func (m AppModel) Init() tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			return AllVaultsMsg{Vaults: LoadAllVaults(m.ctx, m.state.Registry)}
		},
		func() tea.Msg {
			return BackupsMsg{Backups: LoadBackups(m.ctx)}
		},
	)
}

// Update handles all messages and keyboard events.
func (m AppModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	s := m.state
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		s.Width = msg.Width
		s.Height = msg.Height

	case tea.KeyMsg:
		// Filter editing captures all input.
		if s.FilterEditing {
			model, cmd := s.FilterInput.Update(msg)
			s.FilterInput = model
			s.Filters[s.Tab] = s.FilterInput.Value()
			s.MainIndex[s.Tab] = 0
			cmds = append(cmds, cmd)
			if msg.String() == "enter" || msg.String() == "esc" {
				s.FilterEditing = false
				s.FilterInput.Blur()
			}
			m.state = s
			return m, tea.Batch(cmds...)
		}
		// Modal input.
		if top := s.topModal(); top != nil {
			newS, cmd := handleModalKey(m.ctx, &s, top, msg)
			s = *newS
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			m.state = s
			return m, tea.Batch(cmds...)
		}
		// Pane / global keys.
		newS, cmd := handlePaneKey(m.ctx, &s, msg)
		s = *newS
		if cmd != nil {
			cmds = append(cmds, cmd)
		}

	case AllVaultsMsg:
		s.Vaults = msg.Vaults
		s.Ready = true

	case VaultRuntimeMsg:
		s.Vaults[msg.Vault] = msg.Runtime

	case RegistryReloadedMsg:
		s.Registry = msg.Reg
		if _, ok := s.Registry.Vaults[s.ActiveVault]; !ok {
			s.ActiveVault = s.Registry.Defaults.Vault
		}
		cmds = append(cmds, refreshAfterApply(m.ctx, s.Registry))

	case OpAppliedMsg:
		s.Registry = msg.Reg
		s.Status = &StatusMsg{Text: "applied"}
		s.popModal()
		cmds = append(cmds, refreshAfterApply(m.ctx, s.Registry))

	case FindingsMsg:
		s.Findings = msg.Findings

	case BackupsMsg:
		s.Backups = msg.Backups

	case SetStatusMsg:
		s.Status = msg.S

	case BusyMsg:
		s.Busy = msg.Label

	case ErrMsg:
		s.Status = &StatusMsg{Text: msg.Err.Error(), IsErr: true}

	case tuiErrMsg:
		s.Status = &StatusMsg{Text: msg.err.Error(), IsErr: true}
		s.popModal()
	}

	m.state = s
	return m, tea.Batch(cmds...)
}

// View renders the full TUI.
func (m AppModel) View() string {
	s := &m.state
	if s.Width == 0 {
		return "loading…\n"
	}

	var sb strings.Builder
	sb.WriteString(renderHeader(s) + "\n")
	sb.WriteString(renderStatus(s) + "\n")

	contentH := s.Height - 3
	if contentH < 1 {
		contentH = 1
	}

	if top := s.topModal(); top != nil {
		sb.WriteString(renderModal(m.ctx, s, top, s.Width, contentH))
	} else {
		sb.WriteString(renderPanes(m.ctx, s, s.Width, contentH))
	}

	sb.WriteString("\n" + renderFooter(s))
	return sb.String()
}

// ── header ────────────────────────────────────────────────────────────────────

func renderHeader(s *AppState) string {
	title := styleTitle.Render("menv")
	vault := ""
	if s.ActiveVault != "" {
		rt := s.Vaults[s.ActiveVault]
		icon := "●"
		if !rt.Unlocked {
			icon = "○"
		}
		vault = styleMuted.Render("vault: ") + icon + " " + s.ActiveVault
	}
	tabStr := renderTabBar(s)
	right := vault + "  " + tabStr
	gap := s.Width - lipgloss.Width(title) - lipgloss.Width(right)
	if gap < 1 {
		gap = 1
	}
	return title + strings.Repeat(" ", gap) + right
}

func renderTabBar(s *AppState) string {
	var parts []string
	for _, t := range allTabs {
		label := string(t)
		if t == s.Tab {
			parts = append(parts, styleSelected.Padding(0, 1).Render(label))
		} else {
			parts = append(parts, styleMuted.Padding(0, 1).Render(label))
		}
	}
	return strings.Join(parts, "")
}

// ── status bar ────────────────────────────────────────────────────────────────

func renderStatus(s *AppState) string {
	if s.Busy != nil {
		return styleMuted.Render("● " + *s.Busy + "…")
	}
	if s.Status != nil {
		if s.Status.IsErr {
			return styleStatusErr.Render("✖ " + s.Status.Text)
		}
		return styleStatus.Render("✔ " + s.Status.Text)
	}
	if s.Findings != nil {
		errCount := 0
		for _, f := range s.Findings {
			if f.Severity == "error" {
				errCount++
			}
		}
		if errCount > 0 {
			return styleErr.Render(fmt.Sprintf("✖ %d check error(s) — press C to view", errCount))
		}
		return styleSuccess.Render("✔ all checks passed")
	}
	return styleMuted.Render("ready")
}

// ── footer ────────────────────────────────────────────────────────────────────

func renderFooter(s *AppState) string {
	return FormatHints(FooterHints(s))
}
