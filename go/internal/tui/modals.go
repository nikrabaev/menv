package tui

import (
	"fmt"
	"strings"

	"charm.land/bubbles/v2/viewport"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"github.com/nikrabaev/menv/go/internal/core/ops"
)

// modal is one entry on the modal stack. Only the topmost modal receives input.
type modal interface {
	Init() tea.Cmd
	Update(a *App, msg tea.Msg) tea.Cmd
	View(a *App) string
}

func isKey(msg tea.Msg, s string) bool {
	k, ok := msg.(tea.KeyPressMsg)
	return ok && k.String() == s
}

// ── quit ────────────────────────────────────────────────────────────────────

type quitModal struct{}

func (quitModal) Init() tea.Cmd { return nil }
func (quitModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if k, ok := msg.(tea.KeyPressMsg); ok {
		switch k.String() {
		case "y", "q", "enter":
			return tea.Quit
		case "n", "esc":
			a.popModal()
		}
	}
	return nil
}
func (q quitModal) View(a *App) string {
	body := "All changes are already applied — nothing is pending.\n\n" +
		a.style.keyCap.Render("y") + a.style.keyDesc.Render(" quit   ") +
		a.style.keyCap.Render("n") + a.style.keyDesc.Render(" stay")
	return a.frameModal("Quit menv?", body, false)
}

// ── confirm ─────────────────────────────────────────────────────────────────

type confirmModal struct {
	title, body string
	danger      bool
	onYes       func(a *App) tea.Cmd
}

func (m *confirmModal) Init() tea.Cmd { return nil }
func (m *confirmModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if k, ok := msg.(tea.KeyPressMsg); ok {
		switch k.String() {
		case "y", "enter":
			a.popModal()
			if m.onYes != nil {
				return m.onYes(a)
			}
		case "n", "esc":
			a.popModal()
		}
	}
	return nil
}
func (m *confirmModal) View(a *App) string {
	body := m.body + "\n\n" +
		a.style.keyCap.Render("y") + a.style.keyDesc.Render(" confirm   ") +
		a.style.keyCap.Render("n") + a.style.keyDesc.Render(" cancel")
	return a.frameModal(m.title, body, m.danger)
}

// ── plan confirm ────────────────────────────────────────────────────────────

type planConfirmModal struct {
	title string
	label string
	op    ops.OpResult
	armed bool
	post  func(root string) error
}

func (m *planConfirmModal) Init() tea.Cmd { return nil }
func (m *planConfirmModal) Update(a *App, msg tea.Msg) tea.Cmd {
	k, ok := msg.(tea.KeyPressMsg)
	if !ok {
		return nil
	}
	plan := m.op.Plan
	switch k.String() {
	case "esc":
		a.popModal()
	case "f":
		if len(plan.Blockers) > 0 {
			m.armed = true
		}
	case "enter":
		if len(plan.Blockers) > 0 && !m.armed {
			a.setStatus(statusErr, "blocked — press f to force")
			return nil
		}
		a.popModal()
		a.busy = m.label
		return tea.Batch(a.applyPlanCmd(m.op, m.armed, m.label, m.post), a.spinner.Tick)
	}
	return nil
}
func (m *planConfirmModal) View(a *App) string {
	plan := m.op.Plan
	var b strings.Builder
	empty := len(plan.Registry)+len(plan.Vaults)+len(plan.Files)+len(plan.Warnings)+len(plan.Blockers) == 0
	if empty {
		b.WriteString(a.style.muted.Render("no changes"))
	}
	for _, op := range plan.Registry {
		b.WriteString(fmt.Sprintf("%s %s — %s\n", a.style.keyCap.Render(op.Action), op.Path, a.style.muted.Render(op.Summary)))
	}
	for _, op := range plan.Vaults {
		b.WriteString(a.style.subtle.Render(fmt.Sprintf("vault %s: %s key %s\n", op.Vault, op.Action, op.Key)))
	}
	for _, op := range plan.Files {
		b.WriteString(a.style.subtle.Render(fmt.Sprintf("file %s %s\n", op.Action, op.Path)))
	}
	for _, w := range plan.Warnings {
		b.WriteString(a.style.warning.Render("⚠ "+w.Code+": "+w.Message) + "\n")
	}
	for _, bl := range plan.Blockers {
		b.WriteString(a.style.blocker.Render("✖ "+bl.Code+": "+bl.Message) + "\n")
	}
	b.WriteString("\n")
	if len(plan.Blockers) > 0 {
		if m.armed {
			b.WriteString(a.style.blocker.Render("forced — ") + a.style.keyCap.Render("⏎") + a.style.keyDesc.Render(" apply   "))
		} else {
			b.WriteString(a.style.keyCap.Render("f") + a.style.keyDesc.Render(" arm force   "))
		}
	} else {
		b.WriteString(a.style.keyCap.Render("⏎") + a.style.keyDesc.Render(" apply   "))
	}
	b.WriteString(a.style.keyCap.Render("esc") + a.style.keyDesc.Render(" cancel"))
	return a.frameModal(m.title, b.String(), len(plan.Blockers) > 0)
}

// ── reveal ──────────────────────────────────────────────────────────────────

type revealModal struct {
	title string
	value string
}

func (m *revealModal) Init() tea.Cmd { return nil }
func (m *revealModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if isKey(msg, "enter") || isKey(msg, "esc") {
		a.popModal()
	}
	return nil
}
func (m *revealModal) View(a *App) string {
	val := m.value
	if val == "" {
		val = a.style.muted.Render("(empty)")
	}
	body := val + "\n\n" + a.style.keyDesc.Render("⏎/esc close")
	return a.frameModal(m.title, body, true)
}

// ── orphan prompt ───────────────────────────────────────────────────────────

type orphanPromptModal struct {
	keys     []string
	onChoose func(a *App, remove bool) tea.Cmd
}

func (m *orphanPromptModal) Init() tea.Cmd { return nil }
func (m *orphanPromptModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if k, ok := msg.(tea.KeyPressMsg); ok {
		switch k.String() {
		case "y", "enter":
			a.popModal()
			return m.onChoose(a, true)
		case "n":
			a.popModal()
			return m.onChoose(a, false)
		case "esc":
			a.popModal()
		}
	}
	return nil
}
func (m *orphanPromptModal) View(a *App) string {
	var b strings.Builder
	b.WriteString("These vault keys would become unreferenced:\n\n")
	for _, k := range m.keys {
		b.WriteString("  " + a.style.warning.Render(k) + "\n")
	}
	b.WriteString("\n" + a.style.keyCap.Render("y") + a.style.keyDesc.Render(" drop them   ") +
		a.style.keyCap.Render("n") + a.style.keyDesc.Render(" keep them   ") +
		a.style.keyCap.Render("esc") + a.style.keyDesc.Render(" cancel"))
	return a.frameModal("Orphaned keys", b.String(), false)
}

// ── findings ────────────────────────────────────────────────────────────────

type findingsModal struct {
	vp viewport.Model
}

func newFindingsModal(a *App) *findingsModal {
	w, h := a.modalInnerSize()
	vp := viewport.New(viewport.WithWidth(w), viewport.WithHeight(h))
	var b strings.Builder
	if len(a.findings) == 0 {
		b.WriteString(a.style.statusOK.Render("✔ all checks passed"))
	}
	for _, f := range a.findings {
		sym := a.style.warning.Render("⚠")
		if f.Severity == "error" {
			sym = a.style.blocker.Render("✖")
		}
		b.WriteString(fmt.Sprintf("%s %s %s\n", sym, a.style.keyCap.Render(f.Code), f.Message))
	}
	vp.SetContent(b.String())
	return &findingsModal{vp: vp}
}
func (m *findingsModal) Init() tea.Cmd { return nil }
func (m *findingsModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if isKey(msg, "esc") || isKey(msg, "q") {
		a.popModal()
		return nil
	}
	var cmd tea.Cmd
	m.vp, cmd = m.vp.Update(msg)
	return cmd
}
func (m *findingsModal) View(a *App) string {
	body := m.vp.View() + "\n" + a.style.keyDesc.Render("↑/↓ scroll · esc close")
	return a.frameModal("menv check", body, false)
}

// ── detail (narrow-mode inspector) ──────────────────────────────────────────

// detailModal shows the inspector body in a modal — the escape hatch for when
// the inspector pane is hidden (narrow terminal). Read-only, like the pane it
// mirrors; j/k scroll, esc/enter/q close.
type detailModal struct {
	vp viewport.Model
}

func newDetailModal(a *App) *detailModal {
	w, h := a.modalInnerSize()
	vp := viewport.New(viewport.WithWidth(w), viewport.WithHeight(h))
	vp.SetContent(a.renderInspector(w))
	return &detailModal{vp: vp}
}
func (m *detailModal) Init() tea.Cmd { return nil }
func (m *detailModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if isKey(msg, "esc") || isKey(msg, "enter") || isKey(msg, "q") {
		a.popModal()
		return nil
	}
	var cmd tea.Cmd
	m.vp, cmd = m.vp.Update(msg)
	return cmd
}
func (m *detailModal) View(a *App) string {
	body := m.vp.View() + "\n" + a.style.keyDesc.Render("↑/↓ scroll · esc close")
	return a.frameModal("Inspector", body, false)
}

// ── help ────────────────────────────────────────────────────────────────────

type helpModal struct {
	vp viewport.Model
}

func newHelpModal(a *App) *helpModal {
	w, h := a.modalInnerSize()
	vp := viewport.New(viewport.WithWidth(w), viewport.WithHeight(h))
	var b strings.Builder
	for _, sec := range helpSections() {
		b.WriteString(a.style.title.Render(sec.title) + "\n")
		for _, r := range sec.rows {
			b.WriteString("  " + a.style.keyCap.Render(pad(r[0], 12)) + a.style.keyDesc.Render(r[1]) + "\n")
		}
		b.WriteString("\n")
	}
	b.WriteString(a.style.title.Render("Glyphs") + "\n")
	for _, g := range glyphLegend() {
		b.WriteString("  " + a.style.keyCap.Render(pad(g[0], 12)) + a.style.keyDesc.Render(g[1]) + "\n")
	}
	vp.SetContent(b.String())
	return &helpModal{vp: vp}
}
func (m *helpModal) Init() tea.Cmd { return nil }
func (m *helpModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if isKey(msg, "esc") || isKey(msg, "q") || isKey(msg, "?") {
		a.popModal()
		return nil
	}
	var cmd tea.Cmd
	m.vp, cmd = m.vp.Update(msg)
	return cmd
}
func (m *helpModal) View(a *App) string {
	body := m.vp.View() + "\n" + a.style.keyDesc.Render("↑/↓ scroll · esc close")
	return a.frameModal("Help", body, false)
}

// ── generate ────────────────────────────────────────────────────────────────

type genPhase int

const (
	genLoading genPhase = iota
	genPreviewPhase
	genApplying
	genError
)

type generateModal struct {
	phase   genPhase
	preview generatePreview
	errText string
}

func (m *generateModal) Init() tea.Cmd { return nil }
func (m *generateModal) Update(a *App, msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case genPreviewMsg:
		if msg.err != nil {
			m.phase = genError
			m.errText = msg.err.Error()
			return nil
		}
		m.preview = msg.preview
		m.phase = genPreviewPhase
		return nil
	case genAppliedMsg:
		a.popModal()
		if msg.err != nil {
			a.setStatus(statusErr, msg.err.Error())
			return nil
		}
		a.setStatus(statusOK, fmt.Sprintf("generated %d file(s)", msg.count))
		return a.loadFindingsCmd()
	case tea.KeyPressMsg:
		switch msg.String() {
		case "esc":
			if m.phase == genLoading || m.phase == genPreviewPhase || m.phase == genError {
				a.popModal()
			}
		case "enter":
			if m.phase == genPreviewPhase {
				m.phase = genApplying
				return a.genApplyCmd(m.preview)
			}
		}
	}
	return nil
}
func (m *generateModal) View(a *App) string {
	var b strings.Builder
	switch m.phase {
	case genLoading:
		b.WriteString(a.spinner.View() + " computing preview…")
	case genError:
		b.WriteString(a.style.blocker.Render("error: " + m.errText))
		b.WriteString("\n\n" + a.style.keyDesc.Render("esc close"))
	case genApplying:
		b.WriteString(a.spinner.View() + " writing files…")
	case genPreviewPhase:
		p := m.preview
		b.WriteString(fmt.Sprintf("write: %d · unchanged: %d · refused: %d\n\n",
			len(p.writes), len(p.unchanged), len(p.refused)))
		max := 10
		for i, w := range p.writes {
			if i >= max {
				b.WriteString(a.style.muted.Render(fmt.Sprintf("  … %d more\n", len(p.writes)-max)))
				break
			}
			b.WriteString(a.style.hasValue.Render("  + "+w) + "\n")
		}
		for _, r := range p.refused {
			b.WriteString(a.style.blocker.Render("  ! "+r+" (no marker — left as is)") + "\n")
		}
		for _, w := range p.warnings {
			b.WriteString(a.style.warning.Render("  ⚠ "+w.Code+": "+w.Message) + "\n")
		}
		b.WriteString("\n" + a.style.keyCap.Render("⏎") + a.style.keyDesc.Render(" apply   ") +
			a.style.keyCap.Render("esc") + a.style.keyDesc.Render(" cancel"))
	}
	return a.frameModal("Generate", b.String(), false)
}

// ── form (huh) ──────────────────────────────────────────────────────────────

type formModal struct {
	title    string
	danger   bool
	form     *huh.Form
	onSubmit func(a *App) tea.Cmd
}

func (m *formModal) Init() tea.Cmd { return m.form.Init() }
func (m *formModal) Update(a *App, msg tea.Msg) tea.Cmd {
	model, cmd := m.form.Update(msg)
	if f, ok := model.(*huh.Form); ok {
		m.form = f
	}
	switch m.form.State {
	case huh.StateCompleted:
		a.popModal()
		if m.onSubmit != nil {
			return tea.Batch(cmd, m.onSubmit(a))
		}
	case huh.StateAborted:
		a.popModal()
	}
	return cmd
}
func (m *formModal) View(a *App) string {
	return a.frameModal(m.title, m.form.View(), m.danger)
}

// ── unlock (huh) ────────────────────────────────────────────────────────────

type unlockModal struct {
	vault      string
	secret     *string
	form       *huh.Form
	pending    bool
	errText    string
	onUnlocked func(a *App) tea.Cmd
}

func (m *unlockModal) Init() tea.Cmd { return m.form.Init() }
func (m *unlockModal) Update(a *App, msg tea.Msg) tea.Cmd {
	if m.pending {
		return nil // unlockResultMsg is handled centrally in App.Update
	}
	model, cmd := m.form.Update(msg)
	if f, ok := model.(*huh.Form); ok {
		m.form = f
	}
	switch m.form.State {
	case huh.StateCompleted:
		m.pending = true
		return tea.Batch(a.spinner.Tick, a.tryUnlockCmd(m.vault, *m.secret))
	case huh.StateAborted:
		a.popModal()
	}
	return cmd
}
func (m *unlockModal) View(a *App) string {
	if m.pending {
		return a.frameModal("Unlock "+m.vault, a.spinner.View()+" unlocking…", false)
	}
	body := m.form.View()
	if m.errText != "" {
		body = a.style.blocker.Render(m.errText) + "\n\n" + body
	}
	return a.frameModal("Unlock "+m.vault, body, false)
}

// ── consumer pick (huh) ─────────────────────────────────────────────────────

type consumerPickModal struct {
	form   *huh.Form
	choice *string
	onPick func(a *App, consumer string) tea.Cmd
}

func (m *consumerPickModal) Init() tea.Cmd { return m.form.Init() }
func (m *consumerPickModal) Update(a *App, msg tea.Msg) tea.Cmd {
	model, cmd := m.form.Update(msg)
	if f, ok := model.(*huh.Form); ok {
		m.form = f
	}
	switch m.form.State {
	case huh.StateCompleted:
		a.popModal()
		return m.onPick(a, *m.choice)
	case huh.StateAborted:
		a.popModal()
	}
	return cmd
}
func (m *consumerPickModal) View(a *App) string {
	return a.frameModal("Pick a consumer", m.form.View(), false)
}
