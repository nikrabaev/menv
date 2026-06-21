package tui

import (
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

const sidebarWidth = 28

// renderPanes renders the two- or three-pane layout.
func renderPanes(ctx *TuiContext, s *AppState, w, h int) string {
	hasInspector := !s.HumanMode && s.Focus == PaneInspector && s.Tab == TabVariables
	inspW := 0
	if hasInspector {
		inspW = 32
	}
	mainW := w - sidebarWidth - 2 - inspW
	if inspW > 0 {
		mainW -= 2
	}
	if mainW < 1 {
		mainW = 1
	}

	sidebar := renderSidebar(s, sidebarWidth, h)
	main := renderMainPane(ctx, s, mainW, h)

	if hasInspector {
		insp := renderInspector(ctx, s, inspW, h)
		return lipgloss.JoinHorizontal(lipgloss.Top, sidebar, " ", main, " ", insp)
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, sidebar, " ", main)
}

// ── sidebar ───────────────────────────────────────────────────────────────────

type sidebarEntry struct {
	kind     string // "header" | "vault" | "consumer"
	name     string
	locked   bool
	isActive bool // vault = active vault; consumer = current filter
}

func buildSidebarEntries(s *AppState) []sidebarEntry {
	var entries []sidebarEntry
	entries = append(entries, sidebarEntry{kind: "header", name: "VAULTS"})
	vaultNames := sortedStringKeys(s.Registry.Vaults)
	for _, n := range vaultNames {
		rt := s.Vaults[n]
		entries = append(entries, sidebarEntry{
			kind:     "vault",
			name:     n,
			locked:   !rt.Unlocked,
			isActive: n == s.ActiveVault,
		})
	}
	if len(s.Registry.Consumers) > 0 {
		entries = append(entries, sidebarEntry{kind: "header", name: "CONSUMERS"})
		for _, n := range sortedStringKeys(s.Registry.Consumers) {
			entries = append(entries, sidebarEntry{
				kind:     "consumer",
				name:     n,
				isActive: s.ConsumerFilter != nil && *s.ConsumerFilter == n,
			})
		}
	}
	return entries
}

func renderSidebar(s *AppState, w, h int) string {
	entries := buildSidebarEntries(s)
	// Clamp index to skip headers.
	selectable := 0
	for _, e := range entries {
		if e.kind != "header" {
			selectable++
		}
	}
	if s.SidebarIndex >= selectable && selectable > 0 {
		s.SidebarIndex = selectable - 1
	}

	var lines []string
	si := 0
	for _, e := range entries {
		var line string
		switch e.kind {
		case "header":
			line = styleHeader.Width(w).Render(e.name)
		case "vault":
			icon := styleSuccess.Render("●")
			if e.locked {
				icon = styleMuted.Render("○")
			}
			name := e.name
			if e.isActive {
				name = stylePaneTitle.Render(name)
			}
			text := icon + " " + name
			if si == s.SidebarIndex && s.Focus == PaneSidebar {
				line = styleSelected.Width(w).Render(stripAnsi(text) + "")
			} else {
				line = padRight(text, w)
			}
			si++
		case "consumer":
			prefix := "  "
			if e.isActive {
				prefix = styleAccent.Render("▶ ")
			}
			text := prefix + e.name
			if si == s.SidebarIndex && s.Focus == PaneSidebar {
				line = styleSelected.Width(w).Render(e.name)
			} else {
				line = padRight(text, w)
			}
			si++
		}
		lines = append(lines, line)
	}

	// Pad to height.
	for len(lines) < h {
		lines = append(lines, strings.Repeat(" ", w))
	}
	content := strings.Join(lines[:min(len(lines), h)], "\n")

	border := styleBorder
	if s.Focus == PaneSidebar {
		border = styleBorderActive
	}
	return border.Width(w).Height(h).Render(content)
}

// ── main pane ─────────────────────────────────────────────────────────────────

func renderMainPane(ctx *TuiContext, s *AppState, w, h int) string {
	var content string
	switch s.Tab {
	case TabVariables:
		content = renderVariablesTab(ctx, s, w, h)
	case TabGlobals:
		content = renderGlobalsTab(s, w, h)
	case TabGroups:
		content = renderGroupsTab(s, w, h)
	case TabCompose:
		content = renderComposeTab(s, w, h)
	case TabBackups:
		content = renderBackupsTab(s, w, h)
	}

	border := styleBorder
	if s.Focus == PaneMain {
		border = styleBorderActive
	}
	// Add filter bar if active.
	if s.FilterEditing || s.Filters[s.Tab] != "" {
		filterLine := "/" + s.FilterInput.View()
		content = filterLine + "\n" + content
		h--
	}
	return border.Width(w).Height(h).Render(content)
}

// variables tab

type varRow struct {
	kind     string // "header" | "var"
	name     string
	group    string
	secret   bool
	disabled bool
	wired    string // summary of vault/consumer wiring
}

func buildVarRows(s *AppState) []varRow {
	var rows []varRow
	names := sortedStringKeys(s.Registry.Variables)
	filter := strings.ToLower(s.Filters[TabVariables])

	grouped := map[string][]varRow{}
	ungrouped := []varRow{}

	for _, name := range names {
		def := s.Registry.Variables[name]
		if filter != "" && !strings.Contains(strings.ToLower(name), filter) {
			continue
		}
		if s.ConsumerFilter != nil {
			// Only show if wired to this consumer.
			found := false
			for _, byC := range def.VaultMapping {
				if _, ok := byC[*s.ConsumerFilter]; ok {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		var parts []string
		for _, v := range sortedStringKeys(def.VaultMapping) {
			cs := []string{}
			for c := range def.VaultMapping[v] {
				cs = append(cs, c)
			}
			sort.Strings(cs)
			parts = append(parts, v+":"+strings.Join(cs, ","))
		}
		wired := strings.Join(parts, " ")
		if wired == "" {
			wired = "unwired"
		}
		r := varRow{kind: "var", name: name, group: def.GroupKey, secret: def.Secret, wired: wired}
		if def.GroupKey != "" {
			grouped[def.GroupKey] = append(grouped[def.GroupKey], r)
		} else {
			ungrouped = append(ungrouped, r)
		}
	}

	// Output grouped first, then ungrouped.
	groupKeys := sortedStringKeys(s.Registry.Groups)
	for _, k := range groupKeys {
		if rs, ok := grouped[k]; ok {
			title := k
			if gd, exists := s.Registry.Groups[k]; exists && gd.Title != "" {
				title = gd.Title
			}
			rows = append(rows, varRow{kind: "header", name: title})
			rows = append(rows, rs...)
		}
	}
	rows = append(rows, ungrouped...)
	return rows
}

func renderVariablesTab(ctx *TuiContext, s *AppState, w, h int) string {
	rows := buildVarRows(s)
	// Count selectable rows.
	sel := 0
	for _, r := range rows {
		if r.kind == "var" {
			sel++
		}
	}

	idx := s.MainIndex[TabVariables]
	var lines []string
	ri := 0
	for _, r := range rows {
		switch r.kind {
		case "header":
			lines = append(lines, styleHeader.Render("── "+r.name+" ──"))
		case "var":
			prefix := "  "
			name := r.name
			wired := styleMuted.Render(r.wired)
			if r.secret {
				name = styleSecret.Render(name)
			}
			text := prefix + name + " " + wired
			if ri == idx && s.Focus == PaneMain {
				lines = append(lines, styleSelected.Width(w).Render(r.name+" "+r.wired))
			} else {
				lines = append(lines, padRight(text, w))
			}
			ri++
		}
	}
	if len(rows) == 0 {
		lines = []string{styleMuted.Render("no variables")}
	}
	return clipLines(lines, h)
}

func renderGlobalsTab(s *AppState, w, h int) string {
	names := sortedStringKeys(s.Registry.Globals)
	filter := strings.ToLower(s.Filters[TabGlobals])
	idx := s.MainIndex[TabGlobals]
	var lines []string
	ri := 0
	for _, name := range names {
		if filter != "" && !strings.Contains(strings.ToLower(name), filter) {
			continue
		}
		g := s.Registry.Globals[name]
		var parts []string
		for _, v := range sortedStringKeys(g.Values) {
			parts = append(parts, v+":"+g.Values[v].Source)
		}
		text := name + " " + styleMuted.Render(strings.Join(parts, " "))
		if ri == idx && s.Focus == PaneMain {
			lines = append(lines, styleSelected.Width(w).Render(name+" "+strings.Join(parts, " ")))
		} else {
			lines = append(lines, padRight(text, w))
		}
		ri++
	}
	if len(lines) == 0 {
		lines = []string{styleMuted.Render("no globals")}
	}
	return clipLines(lines, h)
}

func renderGroupsTab(s *AppState, w, h int) string {
	keys := sortedStringKeys(s.Registry.Groups)
	idx := s.MainIndex[TabGroups]
	var lines []string
	for i, k := range keys {
		g := s.Registry.Groups[k]
		text := k + " " + styleMuted.Render(g.Title)
		if i == idx && s.Focus == PaneMain {
			lines = append(lines, styleSelected.Width(w).Render(k+" "+g.Title))
		} else {
			lines = append(lines, padRight(text, w))
		}
	}
	if len(lines) == 0 {
		lines = []string{styleMuted.Render("no groups")}
	}
	return clipLines(lines, h)
}

func renderComposeTab(s *AppState, w, h int) string {
	files := s.Registry.Compose.Files
	idx := s.MainIndex[TabCompose]
	var lines []string
	for i, f := range files {
		if i == idx && s.Focus == PaneMain {
			lines = append(lines, styleSelected.Width(w).Render(f))
		} else {
			lines = append(lines, padRight(f, w))
		}
	}
	if len(lines) == 0 {
		lines = []string{styleMuted.Render("no compose files bound")}
	}
	return clipLines(lines, h)
}

func renderBackupsTab(s *AppState, w, h int) string {
	idx := s.MainIndex[TabBackups]
	var lines []string
	for i, b := range s.Backups {
		if i == idx && s.Focus == PaneMain {
			lines = append(lines, styleSelected.Width(w).Render(b))
		} else {
			lines = append(lines, padRight(b, w))
		}
	}
	if len(lines) == 0 {
		lines = []string{styleMuted.Render("no backups")}
	}
	return clipLines(lines, h)
}

// ── inspector ─────────────────────────────────────────────────────────────────

func renderInspector(ctx *TuiContext, s *AppState, w, h int) string {
	varRows := buildVarRows(s)
	idx := s.MainIndex[TabVariables]
	ri := 0
	varName := ""
	for _, r := range varRows {
		if r.kind == "var" {
			if ri == idx {
				varName = r.name
				break
			}
			ri++
		}
	}

	var lines []string
	if varName == "" {
		lines = []string{styleMuted.Render("no selection")}
	} else {
		def := s.Registry.Variables[varName]
		lines = append(lines, stylePaneTitle.Render(varName))
		if def.Description != "" {
			lines = append(lines, styleMuted.Render(def.Description))
		}
		lines = append(lines, "")

		ri2 := 0
		for _, vname := range sortedStringKeys(def.VaultMapping) {
			byConsumer := def.VaultMapping[vname]
			rt := s.Vaults[vname]
			for _, cname := range sortedStringKeys(byConsumer) {
				entry := byConsumer[cname]
				val := "••••"
				if s.RevealSecrets && rt.Values != nil {
					if v, ok := rt.Values[entry.Key]; ok {
						val = v
					}
				}
				if !rt.Unlocked {
					val = styleMuted.Render("(locked)")
				}
				status := styleSuccess.Render("●")
				if entry.Disabled {
					status = styleMuted.Render("◌")
					val = styleMuted.Render("disabled")
				}
				text := fmt.Sprintf("%s %s/%s: %s", status, vname, cname, val)
				if ri2 == s.InspectorIndex && s.Focus == PaneInspector {
					lines = append(lines, styleSelected.Width(w).Render(stripAnsi(text)))
				} else {
					lines = append(lines, padRight(text, w))
				}
				ri2++
			}
		}
		if ri2 == 0 {
			lines = append(lines, styleMuted.Render("no wiring"))
		}
	}

	border := styleBorder
	if s.Focus == PaneInspector {
		border = styleBorderActive
	}
	return border.Width(w).Height(h).Render(clipLines(lines, h))
}

// ── modal rendering ───────────────────────────────────────────────────────────

func renderModal(ctx *TuiContext, s *AppState, top Modal, w, h int) string {
	inner := renderModalContent(ctx, s, top, w-4, h-2)
	return styleBorderActive.Width(w - 2).Height(h).Render(inner)
}

func renderModalContent(ctx *TuiContext, s *AppState, top Modal, w, h int) string {
	switch m := top.(type) {
	case HelpModal:
		return renderHelpModal(s, w, h)
	case QuitModal:
		return styleModalTitle.Render("Quit menv?") + "\n\nPress enter to quit or esc to cancel."
	case FindingsModal:
		return renderFindingsModal(s, w, h)
	case PlanModal:
		return renderPlanModal(m, w, h)
	case ConfirmModal:
		return renderConfirmModal(m, w, h)
	case UnlockModal:
		return renderUnlockModal(m, w, h)
	case FormModal:
		return renderFormModal(m, w, h)
	case RevealModal:
		return renderRevealModal(m, w, h)
	case ConsumerPickModal:
		return renderConsumerPickModal(m, w, h)
	case OrphanPromptModal:
		return renderOrphanPromptModal(m, w, h)
	case GenerateModal:
		return renderGenerateModal(s, m, w, h)
	}
	return ""
}

func renderHelpModal(s *AppState, w, h int) string {
	lines := []string{
		styleModalTitle.Render("Keyboard Shortcuts"),
		"",
		styleHeader.Render("Global"),
		styleKeyName.Render("tab") + "  " + styleKeyHint.Render("cycle panes"),
		styleKeyName.Render("[/]") + " " + styleKeyHint.Render("cycle tabs"),
		styleKeyName.Render("?") + "   " + styleKeyHint.Render("help"),
		styleKeyName.Render("q") + "   " + styleKeyHint.Render("quit"),
		styleKeyName.Render("c") + "   " + styleKeyHint.Render("run check"),
		styleKeyName.Render("g") + "   " + styleKeyHint.Render("generate"),
		styleKeyName.Render("R") + "   " + styleKeyHint.Render("reload registry"),
		styleKeyName.Render("^r") + "  " + styleKeyHint.Render("reveal secrets"),
		"",
		styleHeader.Render("Variables"),
		styleKeyName.Render("n") + "   " + styleKeyHint.Render("new variable"),
		styleKeyName.Render("e") + "   " + styleKeyHint.Render("edit"),
		styleKeyName.Render("s") + "   " + styleKeyHint.Render("set value"),
		styleKeyName.Render("w") + "   " + styleKeyHint.Render("wire"),
		styleKeyName.Render("x") + "   " + styleKeyHint.Render("remove"),
		styleKeyName.Render("/") + "   " + styleKeyHint.Render("filter"),
	}
	return clipLines(lines, h)
}

func renderFindingsModal(s *AppState, w, h int) string {
	if len(s.Findings) == 0 {
		return styleSuccess.Render("✔ All checks passed")
	}
	var lines []string
	lines = append(lines, styleModalTitle.Render("Check Findings"))
	for _, f := range s.Findings {
		sym := styleWarn.Render("⚠")
		if f.Severity == "error" {
			sym = styleErr.Render("✖")
		}
		lines = append(lines, sym+" "+styleKeyName.Render(f.Code)+": "+f.Message)
	}
	return clipLines(lines, h)
}

func renderPlanModal(m PlanModal, w, h int) string {
	title := m.Title
	if m.Danger {
		title = styleDanger.Render(title)
	}
	lines := []string{styleModalTitle.Render(title), ""}
	p := m.Op.Plan
	for _, r := range p.Registry {
		lines = append(lines, "  "+styleKeyName.Render(r.Action)+"  "+r.Summary)
	}
	for _, v := range p.Vaults {
		lines = append(lines, "  "+styleKeyName.Render(v.Action)+"  "+v.Vault+": "+v.Key)
	}
	for _, f := range p.Files {
		lines = append(lines, "  "+styleKeyName.Render(f.Action)+"  "+f.Path)
	}
	if len(p.Blockers) > 0 {
		lines = append(lines, "", styleErr.Render("Blockers:"))
		for _, b := range p.Blockers {
			lines = append(lines, "  ✖ "+b.Message)
		}
		if m.Forced {
			lines = append(lines, styleWarn.Render("  (force armed)"))
		}
	}
	lines = append(lines, "", styleMuted.Render("enter: apply  f: force  esc: cancel"))
	return clipLines(lines, h)
}

func renderConfirmModal(m ConfirmModal, w, h int) string {
	title := m.Title
	if m.Danger {
		title = styleDanger.Render(title)
	}
	return styleModalTitle.Render(title) + "\n\n" + m.Body + "\n\n" + styleMuted.Render("enter: confirm  esc: cancel")
}

func renderUnlockModal(m UnlockModal, w, h int) string {
	lines := []string{
		styleModalTitle.Render(fmt.Sprintf(`Unlock vault “%s”`, m.Vault)),
		"",
		m.Input.View(),
	}
	if m.ErrText != "" {
		lines = append(lines, "", styleErr.Render(m.ErrText))
	}
	if m.Trying {
		lines = append(lines, styleMuted.Render("trying…"))
	}
	return strings.Join(lines, "\n")
}

func renderFormModal(m FormModal, w, h int) string {
	lines := []string{styleModalTitle.Render(m.Spec.Title), ""}
	for i, inp := range m.Inputs {
		field := m.Spec.Fields[i]
		label := field.Label
		if field.Required {
			label += " *"
		}
		lines = append(lines, styleKeyHint.Render(label))
		lines = append(lines, inp.View())
		lines = append(lines, "")
	}
	if m.ErrText != "" {
		lines = append(lines, styleErr.Render(m.ErrText))
	}
	return clipLines(lines, h)
}

func renderRevealModal(m RevealModal, w, h int) string {
	title := fmt.Sprintf("Value of %s (vault %s, consumer %s)", m.Variable, m.Vault, m.Consumer)
	val := m.Value
	if val == "" {
		val = styleMuted.Render("(not set)")
	}
	return styleModalTitle.Render(title) + "\n\n" + styleSecret.Render(val) + "\n\n" + styleMuted.Render("esc: close")
}

func renderConsumerPickModal(m ConsumerPickModal, w, h int) string {
	lines := []string{styleModalTitle.Render(m.Title), ""}
	for i, c := range m.Consumers {
		if i == m.Index {
			lines = append(lines, styleSelected.Render("▶ "+c))
		} else {
			lines = append(lines, "  "+c)
		}
	}
	return clipLines(lines, h)
}

func renderOrphanPromptModal(m OrphanPromptModal, w, h int) string {
	lines := []string{
		styleModalTitle.Render(fmt.Sprintf(`Orphaned keys in vault "%s"`, m.Vault)),
		"",
		styleMuted.Render("The following keys are no longer referenced:"),
	}
	for _, k := range m.Keys {
		lines = append(lines, "  • "+k)
	}
	lines = append(lines, "", styleKeyHint.Render("d: delete  k: keep  esc: cancel"))
	return clipLines(lines, h)
}

func renderGenerateModal(s *AppState, m GenerateModal, w, h int) string {
	return styleModalTitle.Render("Generate") + "\n\n" +
		styleMuted.Render("This will regenerate all .env files for vault: "+s.ActiveVault+".") + "\n\n" +
		styleMuted.Render("enter: apply  esc: cancel")
}

// ── helpers ───────────────────────────────────────────────────────────────────

func sortedStringKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func clipLines(lines []string, h int) string {
	if h > 0 && len(lines) > h {
		lines = lines[:h]
	}
	return strings.Join(lines, "\n")
}

func padRight(s string, w int) string {
	visible := lipgloss.Width(s)
	if visible >= w {
		return s
	}
	return s + strings.Repeat(" ", w-visible)
}

// stripAnsi removes ANSI escape codes for use in styleSelected.Render() calls
// where the content has already been styled.
func stripAnsi(s string) string {
	// Simple approach: lipgloss Width is ANSI-aware, so we can render with a
	// fresh style that strips color. For now, return the original; the selected
	// style will override colors anyway.
	return s
}

var styleAccent = lipgloss.NewStyle().Foreground(colorAccent)

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
