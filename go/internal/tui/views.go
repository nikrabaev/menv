package tui

import (
	"encoding/json"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"github.com/nikrabaev/menv/go/internal/generate"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// View implements tea.Model. Alt-screen is requested declaratively (v2 style).
func (a *App) View() tea.View {
	var content string
	switch {
	case a.wizard != nil:
		content = a.wizard.View(a)
	default:
		content = a.renderApp()
		if top := a.topModal(); top != nil {
			content = a.center(top.View(a))
		}
	}
	v := tea.NewView(content)
	v.AltScreen = true
	return v
}

// ── sizing / framing ────────────────────────────────────────────────────────

func (a *App) center(box string) string {
	return lipgloss.Place(a.width, a.height, lipgloss.Center, lipgloss.Center, box)
}

func (a *App) modalBoxWidth() int  { return min(a.width-6, 78) }
func (a *App) modalFormWidth() int { return min(a.width-12, 64) }
func (a *App) modalFormHeight() int {
	return min(a.height-8, 20)
}
func (a *App) modalInnerSize() (int, int) {
	return min(a.width-12, 72), min(a.height-10, 18)
}

func (a *App) frameModal(title, body string, danger bool) string {
	st := a.style.modal
	if danger {
		st = a.style.modalDanger
	}
	inner := a.style.modalTitle.Render(title) + "\n\n" + body
	return st.Width(a.modalBoxWidth()).Render(inner)
}

func (a *App) inspectorVisible() bool { return a.width >= 92 && !a.humanMode }

// ── top-level app layout ────────────────────────────────────────────────────

func (a *App) renderApp() string {
	if a.width < 60 || a.height < 14 {
		return lipgloss.Place(a.width, a.height, lipgloss.Center, lipgloss.Center,
			a.style.muted.Render("terminal too small — needs at least 60×14"))
	}
	header := a.renderHeader()
	status := a.renderStatus()
	footer := a.renderFooter()
	bodyH := a.height - lipgloss.Height(header) - lipgloss.Height(status) - lipgloss.Height(footer)
	if bodyH < 4 {
		bodyH = 4
	}

	sidebarW := 26
	inspectorW := 0
	if a.inspectorVisible() {
		// The inspector scales with the terminal so wiring rows and values fit
		// without truncation on wide screens, with a comfortable floor.
		inspectorW = min(48, max(36, a.width/3))
	}
	mainW := a.width - sidebarW - inspectorW

	parts := []string{
		a.renderPane(a.focus == paneSidebar, sidebarW, bodyH, a.renderSidebar()),
		a.renderPane(a.focus == paneMain, mainW, bodyH, a.renderMainPane(mainW-paneHFrame, bodyH-paneVFrame)),
	}
	if inspectorW > 0 {
		parts = append(parts, a.renderPane(a.focus == paneInspector, inspectorW, bodyH, a.renderInspector(inspectorW-paneHFrame)))
	}
	body := lipgloss.JoinHorizontal(lipgloss.Top, parts...)
	return lipgloss.JoinVertical(lipgloss.Left, header, status, body, footer)
}

// Pane frame overhead under lipgloss v2 border-box sizing: Width/Height are the
// *total* including the 1-cell rounded border on each side plus the 1-cell
// horizontal padding, so the content area is outerW-paneHFrame × outerH-paneVFrame.
const (
	paneHFrame = 4 // 2 border + 2 padding
	paneVFrame = 2 // 2 border (no vertical padding)
)

func (a *App) renderPane(focused bool, outerW, outerH int, content string) string {
	st := a.style.paneBlur
	if focused {
		st = a.style.paneFocus
	}
	// Clip the content to exactly the inner area so it never wraps (which would
	// push the pane taller than its siblings) or overflow the frame.
	return st.Width(outerW).Height(outerH).Render(clipBlock(content, outerW-paneHFrame, outerH-paneVFrame))
}

// clipBlock truncates each line to w cells (ANSI-aware, no wrapping) and caps
// the number of lines at h, so pane content never wraps or overflows. A 1-cell
// margin guards against ambiguous-width glyphs (◆, ⧉) that lipgloss's Width
// might measure one cell wider than ansi.Truncate, which would force a wrap.
func clipBlock(s string, w, h int) string {
	if w > 1 {
		w--
	}
	lines := strings.Split(s, "\n")
	if len(lines) > h {
		lines = lines[:h]
	}
	for i, l := range lines {
		lines[i] = ansi.Truncate(l, w, "…")
	}
	return strings.Join(lines, "\n")
}

func (a *App) renderHeader() string {
	left := a.style.title.Render("menv")
	vault := a.style.muted.Render("vault ") + a.style.subtle.Render(a.activeVault)
	if !a.vaultUnlocked(a.activeVault) {
		vault += " " + a.style.badge.Render(glyphLocked)
	}
	if a.consumerFilter != "" {
		vault += a.style.muted.Render("  consumer ") + a.style.subtle.Render(a.consumerFilter)
	}
	line := left + "   " + a.renderTabs() + "   " + vault
	return lipgloss.NewStyle().MaxWidth(a.width).Render(line)
}

func (a *App) renderTabs() string {
	var parts []string
	for _, t := range allTabs {
		label := " " + t.title() + " "
		if t == a.tab {
			parts = append(parts, a.style.selected.Render(label))
		} else {
			parts = append(parts, a.style.muted.Render(label))
		}
	}
	return strings.Join(parts, "")
}

func (a *App) renderStatus() string {
	clamp := func(s string) string { return lipgloss.NewStyle().MaxWidth(a.width).Render(s) }
	if a.busy != "" {
		return clamp(a.style.statusBusy.Render(a.spinner.View() + " " + a.busy + "…"))
	}
	if a.status != nil {
		switch a.status.kind {
		case statusOK:
			return clamp(a.style.statusOK.Render("✔ " + a.status.text))
		case statusErr:
			return clamp(a.style.statusErr.Render("✖ " + a.status.text))
		default:
			return clamp(a.style.muted.Render(a.status.text))
		}
	}
	if a.findingsLoaded {
		n := 0
		for _, f := range a.findings {
			if f.Severity == "error" {
				n++
			}
		}
		if n > 0 {
			return clamp(a.style.statusErr.Render(fmt.Sprintf("✖ %d error(s) — c to view", n)))
		}
		return clamp(a.style.statusOK.Render("✔ all checks passed"))
	}
	return clamp(a.style.muted.Render("ready"))
}

func (a *App) renderFooter() string {
	if a.filterEditing {
		return a.filterInput.View()
	}
	// ShortHelpView doesn't truncate to the help width, so clamp it ourselves —
	// otherwise a long hint bar makes every line as wide as itself (JoinVertical
	// pads to the widest line) and overflows a narrow terminal.
	return lipgloss.NewStyle().MaxWidth(a.width).Render(a.help.ShortHelpView(a.footerBindings()))
}

// ── sidebar ─────────────────────────────────────────────────────────────────

func (a *App) renderSidebar() string {
	var b strings.Builder
	for i, it := range a.sidebarItems() {
		switch it.kind {
		case sbHeader:
			b.WriteString(a.style.section.Render(it.text) + "\n")
			continue
		case sbPlaceholder:
			b.WriteString("  " + a.style.muted.Render(it.text) + "\n")
			continue
		}
		// Two-cell marker column keeps vault/consumer labels aligned whether or
		// not a row carries the cursor. The active vault and active consumer
		// filter stay marked (●, accent) even when the cursor is elsewhere, so
		// the current selection is always visible.
		cursor := a.focus == paneSidebar && i == a.sidebarIndex
		active := (it.kind == sbVault && it.name == a.activeVault) ||
			(it.kind == sbConsumer && it.name == a.consumerFilter)
		marker, style := "  ", a.style.subtle
		switch {
		case cursor:
			marker, style = a.style.keyCap.Render("▸ "), a.style.title
		case active:
			marker, style = a.style.keyCap.Render(glyphActiveItem+" "), a.style.title
		}
		b.WriteString(marker + style.Render(it.text) + "\n")
	}
	return b.String()
}

// ── main pane ───────────────────────────────────────────────────────────────

func (a *App) renderMainPane(w, h int) string {
	switch a.tab {
	case tabVariables:
		if a.humanMode {
			return a.renderVariablesCards(w, h)
		}
		return a.renderVariablesMatrix(w, h)
	case tabGlobals:
		return a.renderGlobals(w, h)
	case tabGroups:
		return a.renderGroups(w, h)
	case tabCompose:
		return a.renderCompose(w, h)
	case tabBackups:
		return a.renderBackups(w, h)
	}
	return ""
}

// windowBody windows the body `lines` to fit h rows so the line at `sel` stays
// visible, adding "↑ N more" / "↓ N more" indicators (each costs a row) when
// lines are clipped. Returns the block with no trailing newline.
func (a *App) windowBody(lines []string, sel, h int) string {
	if len(lines) == 0 {
		return ""
	}
	start, end, top, bottom := scrollWindow(len(lines), sel, h)
	var b strings.Builder
	if top {
		b.WriteString(a.style.muted.Render(fmt.Sprintf("↑ %d more", start)) + "\n")
	}
	for i := start; i < end; i++ {
		b.WriteString(lines[i])
		if i < end-1 {
			b.WriteString("\n")
		}
	}
	if bottom {
		b.WriteString("\n" + a.style.muted.Render(fmt.Sprintf("↓ %d more", len(lines)-end)))
	}
	return b.String()
}

func (a *App) renderVariablesMatrix(w, h int) string {
	consumers := a.activeVaultConsumers()
	groups := a.groupedVariables()
	nameW, colW := matrixColumns(w, consumers, longestVarName(groups))
	// Left block is "▸ "(2) + name(nameW) + " S "(3); columns follow, colW each.
	head := "  " + pad("VARIABLE", nameW) + " S "
	for _, c := range consumers {
		head += pad(truncStr(c, colW-1), colW)
	}
	header := a.style.section.Render(head)

	if len(groups) == 0 {
		msg := "no variables — n to define"
		if a.filter() != "" || a.consumerFilter != "" {
			msg = "no variables match — esc clears the filter"
		}
		return header + "\n" + a.style.muted.Render(msg)
	}
	// Build every display line (group separators interleaved with rows) and note
	// which line carries the cursor, so the window can keep it on screen.
	var lines []string
	selLine := 0
	idx := 0
	for _, g := range groups {
		lines = append(lines, a.style.section.Render("── "+g.title+" ──"))
		for _, name := range g.vars {
			def := a.reg.Variables[name]
			// Highlight the cursor row whenever the inspector mirrors it (focus
			// on main or inspector), so the variable shown in the inspector is
			// always marked in the list.
			selected := a.focus != paneSidebar && idx == a.mainCursor()
			cursor := "  "
			nameStyle := a.style.subtle
			if selected {
				cursor = a.style.keyCap.Render("▸ ")
				nameStyle = a.style.title
				selLine = len(lines)
			}
			secret := " "
			if def.Secret {
				secret = a.style.secret.Render(glyphSecret)
			}
			row := cursor + nameStyle.Render(pad(truncStr(name, nameW), nameW)) + " " + secret + " "
			for _, c := range consumers {
				gl, st := a.cellGlyph(name, c)
				row += st.Render(pad(gl, colW))
			}
			lines = append(lines, row)
			idx++
		}
	}
	// The header line is pinned; the rest scrolls within the remaining height.
	return header + "\n" + a.windowBody(lines, selLine, h-1)
}

// longestVarName returns the longest variable name across the rendered groups,
// used to size the matrix name column no wider than it needs to be.
func longestVarName(groups []varGroup) int {
	m := 0
	for _, g := range groups {
		for _, v := range g.vars {
			if l := len([]rune(v)); l > m {
				m = l
			}
		}
	}
	return m
}

// matrixColumns picks the variable-name width and per-consumer column width for
// the matrix so consumer names fit as fully as the pane allows. The name column
// is no wider than the longest variable name (within a [12,22] band), freeing
// the rest for consumer columns; on a tight pane nameW shrinks further so each
// column keeps at least a few cells. Each column then grows to fit the longest
// consumer name, capped so a lone glyph never sits in an absurdly wide column.
func matrixColumns(w int, consumers []string, maxVarLen int) (nameW, colW int) {
	nameW = max(12, min(22, maxVarLen))
	n := len(consumers)
	if n == 0 {
		return nameW, 3
	}
	maxName := 1
	for _, c := range consumers {
		if l := len([]rune(c)); l > maxName {
			maxName = l
		}
	}
	// Shrink the name column (to a floor of 12) until each consumer column can
	// have at least 4 cells.
	for nameW > 12 && (w-(2+nameW+3))/n < 4 {
		nameW--
	}
	colsAvail := w - (2 + nameW + 3)
	colW = colsAvail / n
	// Don't grow a column past the longest name it holds (+1 for separation);
	// the absolute cap only guards pathological single-consumer ultra-wide panes.
	if desired := maxName + 1; colW > desired {
		colW = desired
	}
	if colW > 24 {
		colW = 24
	}
	if colW < 3 {
		colW = 3
	}
	return nameW, colW
}

func (a *App) renderVariablesCards(w, h int) string {
	vars := a.flatVariables()
	if len(vars) == 0 {
		msg := "no variables — n to define"
		if a.filter() != "" || a.consumerFilter != "" {
			msg = "no variables match — esc clears the filter"
		}
		return a.style.muted.Render(msg)
	}
	cursor := clamp(a.mainCursor(), len(vars))
	// Flatten every card (cards differ in height) into lines, tracking each card's
	// first line. TrimSuffix drops the card's terminating "\n" so the split's line
	// count matches the card height.
	var lines []string
	cardLo := make([]int, len(vars))
	for i, name := range vars {
		cardLo[i] = len(lines)
		lines = append(lines, strings.Split(strings.TrimSuffix(a.renderCard(name, i == cursor, w), "\n"), "\n")...)
	}
	cardHi := func(i int) int {
		if i+1 < len(vars) {
			return cardLo[i+1]
		}
		return len(lines)
	}
	// Window per line so edge cards clip at the pane border and the list fills the
	// height exactly (whole-card windowing left a partial card's worth of empty
	// rows). Centre on the cursor card so it is never split; report the hidden
	// counts in cards, which reads more naturally than lines for this view.
	sel := (cardLo[cursor] + cardHi(cursor) - 1) / 2
	start, end, top, bottom := scrollWindow(len(lines), sel, h)
	var b strings.Builder
	if top {
		above := 0
		for i := 0; i < len(vars) && cardHi(i) <= start; i++ {
			above++
		}
		b.WriteString(a.style.muted.Render(fmt.Sprintf("↑ %d more", above)) + "\n")
	}
	b.WriteString(strings.Join(lines[start:end], "\n"))
	if bottom {
		below := 0
		for i := len(vars) - 1; i >= 0 && cardLo[i] >= end; i-- {
			below++
		}
		b.WriteString("\n" + a.style.muted.Render(fmt.Sprintf("↓ %d more", below)))
	}
	return b.String()
}

func (a *App) renderCard(name string, selected bool, w int) string {
	def := a.reg.Variables[name]
	nameStyle := a.style.subtle
	cursor := "  "
	if selected {
		nameStyle = a.style.title
		cursor = a.style.keyCap.Render("▸ ")
	}
	header := cursor + nameStyle.Render(name)
	if def.Secret {
		header += " " + a.style.secret.Render(glyphSecret)
	}
	if def.Description != "" {
		header += "  " + a.style.muted.Render(truncStr(def.Description, max(0, w-len(name)-10)))
	}
	var b strings.Builder
	b.WriteString(header + "\n")
	rows := a.variableCard(name)
	if len(rows) == 0 {
		b.WriteString("    " + a.style.muted.Render("not wired in "+a.activeVault+" (w to wire)") + "\n")
	}
	for ri, r := range rows {
		rowCursor := "    "
		if selected && a.humanRowFocus && ri == a.humanRowIndex {
			rowCursor = "  " + a.style.keyCap.Render("▸ ")
		}
		label := strings.Join(r.consumers, ", ")
		b.WriteString(rowCursor + a.style.subtle.Render(pad(truncStr(label, 22), 22)) + " " + a.cardValue(def.Secret, r) + "\n")
	}
	return b.String() + "\n"
}

func (a *App) cardValue(secret bool, r cardRow) string {
	if !a.vaultUnlocked(a.activeVault) {
		return a.style.muted.Render(glyphLocked)
	}
	if r.disabled {
		return a.style.disabled.Render(glyphDisabled + " disabled")
	}
	if !r.hasValue {
		return a.style.muted.Render(glyphEmptyVal)
	}
	if secret && !a.revealSecrets {
		return a.style.secret.Render(glyphMaskedVal)
	}
	return a.style.hasValue.Render(truncStr(r.value, 44))
}

func (a *App) renderGlobals(w, h int) string {
	names := a.globalNames()
	header := a.style.section.Render("  " + pad("GLOBAL", 22) + "SOURCE")
	if len(names) == 0 {
		return header + "\n" + a.style.muted.Render("no globals — n to define")
	}
	rows := make([]string, len(names))
	for i, n := range names {
		cursor, ns := a.rowCursor(i)
		rows[i] = cursor + ns.Render(pad(truncStr(n, 22), 22)) + a.style.muted.Render(a.globalSource(n))
	}
	return header + "\n" + a.windowBody(rows, a.mainCursor(), h-1)
}

func (a *App) renderGroups(w, h int) string {
	keys := a.groupKeysFiltered()
	header := a.style.section.Render("  " + pad("KEY", 16) + pad("TITLE", 24) + "#")
	if len(keys) == 0 {
		return header + "\n" + a.style.muted.Render("no groups — n to add")
	}
	rows := make([]string, len(keys))
	for i, k := range keys {
		cursor, ns := a.rowCursor(i)
		rows[i] = cursor + ns.Render(pad(truncStr(k, 16), 16)) +
			a.style.subtle.Render(pad(truncStr(a.reg.Groups[k].Title, 24), 24)) +
			a.style.muted.Render(fmt.Sprintf("%d", a.groupMemberCount(k)))
	}
	return header + "\n" + a.windowBody(rows, a.mainCursor(), h-1)
}

func (a *App) renderCompose(w, h int) string {
	files := a.composeFiles()
	header := a.style.section.Render("  " + pad("FILE", 34) + "STATUS")
	if len(files) == 0 {
		return header + "\n" + a.style.muted.Render("no compose files bound — n to bind")
	}
	rows := make([]string, len(files))
	for i, f := range files {
		cursor, ns := a.rowCursor(i)
		status := a.composeStatus(f)
		statusStyle := a.style.statusOK
		if strings.HasPrefix(status, "✖") {
			statusStyle = a.style.blocker
		} else if strings.HasPrefix(status, "⚠") {
			statusStyle = a.style.warning
		}
		rows[i] = cursor + ns.Render(pad(truncStr(f, 34), 34)) + statusStyle.Render(status)
	}
	return header + "\n" + a.windowBody(rows, a.mainCursor(), h-1)
}

func (a *App) renderBackups(w, h int) string {
	keys := a.backupsNewestFirst()
	header := a.style.section.Render("  " + pad("BACKUP", 20) + "PATH")
	if len(keys) == 0 {
		return header + "\n" + a.style.muted.Render("no backups — n to create one")
	}
	rows := make([]string, len(keys))
	for i, k := range keys {
		cursor, ns := a.rowCursor(i)
		rows[i] = cursor + ns.Render(pad(k, 20)) + a.style.muted.Render(".menv/backups/"+k)
	}
	return header + "\n" + a.windowBody(rows, a.mainCursor(), h-1)
}

// rowCursor returns the marker column and name style for a list row at index i,
// marked when the main pane (not the sidebar) holds the cursor on that row.
func (a *App) rowCursor(i int) (string, lipgloss.Style) {
	if a.focus != paneSidebar && i == a.mainCursor() {
		return a.style.keyCap.Render("▸ "), a.style.title
	}
	return "  ", a.style.subtle
}

// ── inspector ───────────────────────────────────────────────────────────────

func (a *App) renderInspector(w int) string {
	// Sidebar focus details take precedence.
	if a.focus == paneSidebar {
		item := a.currentSidebarItem()
		switch item.kind {
		case sbVault:
			return a.inspectVault(item.name)
		case sbConsumer:
			return a.inspectConsumer(item.name)
		}
	}
	switch a.tab {
	case tabVariables:
		return a.inspectVariable(w)
	case tabGlobals:
		return a.inspectGlobal()
	case tabGroups:
		return a.inspectGroup()
	case tabCompose:
		return a.inspectCompose()
	case tabBackups:
		return a.inspectBackup()
	}
	return ""
}

func kv(a *App, k, v string) string {
	return a.style.muted.Render(pad(k, 12)) + a.style.subtle.Render(v) + "\n"
}

func (a *App) inspectVault(name string) string {
	def := a.reg.Vaults[name]
	var cfg struct {
		Filename   string `json:"filename"`
		Encryption bool   `json:"encryption"`
	}
	_ = json.Unmarshal(def.VaultConfig, &cfg)
	enc := "plaintext — must stay git-ignored"
	if cfg.Encryption {
		enc = "encrypted (committable)"
	}
	lock := "unlocked"
	if !a.vaultUnlocked(name) {
		lock = "locked — u to unlock"
	}
	def2 := ""
	if a.reg.Defaults.Vault == name {
		def2 = " (default)"
	}
	wired := 0
	for _, v := range a.reg.Variables {
		if len(v.VaultMapping[name]) > 0 {
			wired++
		}
	}
	var b strings.Builder
	b.WriteString(a.style.title.Render("vault "+name+def2) + "\n\n")
	b.WriteString(kv(a, "type", def.VaultType))
	b.WriteString(kv(a, "file", cfg.Filename))
	b.WriteString(kv(a, "encryption", enc))
	b.WriteString(kv(a, "state", lock))
	b.WriteString(kv(a, "wired vars", fmt.Sprintf("%d", wired)))
	return b.String()
}

func (a *App) inspectConsumer(name string) string {
	def := a.reg.Consumers[name]
	secrets := "inline"
	if def.StrategyConfig.SecretsAsLocalOverrides {
		secrets = "→ .local override file"
	}
	example := "no"
	if def.StrategyConfig.Example {
		example = "yes"
	}
	wired := 0
	for _, v := range a.reg.Variables {
		for _, byC := range v.VaultMapping {
			if _, ok := byC[name]; ok {
				wired++
				break
			}
		}
	}
	var b strings.Builder
	b.WriteString(a.style.title.Render("consumer "+name) + "\n\n")
	b.WriteString(kv(a, "strategy", def.StrategyType))
	b.WriteString(kv(a, "baseDir", def.StrategyConfig.BaseDir))
	if def.StrategyType == "single" {
		b.WriteString(kv(a, "filename", def.StrategyConfig.Filename))
	} else {
		b.WriteString(kv(a, "filenames", pairsToString(def.StrategyConfig.Filenames)))
	}
	b.WriteString(kv(a, "secrets", secrets))
	b.WriteString(kv(a, ".env.example", example))
	b.WriteString(kv(a, "wired vars", fmt.Sprintf("%d", wired)))
	b.WriteString("\n" + a.style.section.Render("OUTPUT PATHS") + "\n")
	cp := consumerPathsList(def)
	for _, p := range cp {
		b.WriteString("  " + a.style.muted.Render(p) + "\n")
	}
	return b.String()
}

func (a *App) inspectVariable(w int) string {
	name := a.selectedVariable()
	if name == "" {
		return a.style.muted.Render("no variable selected")
	}
	def := a.reg.Variables[name]
	var b strings.Builder
	title := name
	if def.Secret {
		title += " " + glyphSecret
	}
	b.WriteString(a.style.title.Render(title) + "\n\n")
	if def.GroupKey != "" {
		b.WriteString(kv(a, "group", def.GroupKey))
	}
	if def.Description != "" {
		b.WriteString(kv(a, "description", def.Description))
	}
	if def.Example != "" {
		b.WriteString(kv(a, "example", def.Example))
	}
	b.WriteString("\n" + a.style.section.Render("WIRING") + "\n")
	rows := a.variableWiring(name)
	if len(rows) == 0 {
		b.WriteString(a.style.muted.Render("unwired — press w to wire it"))
		return b.String()
	}
	// Two lines per wiring: a label line (glyph + vault/consumer + shared) and
	// an indented value line. Keeps long values readable in the narrow pane.
	for i, r := range rows {
		cursor := "  "
		if a.focus == paneInspector && i == a.inspectorIndex {
			cursor = a.style.keyCap.Render("▸ ")
		}
		gl, st := a.wiringGlyph(name, r)
		shared := ""
		if r.shared {
			shared = a.style.shared.Render(" ⧉ shared")
		}
		b.WriteString(cursor + st.Render(gl) + " " +
			a.style.subtle.Render(r.vault+"/"+r.consumer) + shared + "\n")
		b.WriteString("    " + a.wiringValue(def, r, w) + "\n")
	}
	return b.String()
}

func (a *App) wiringGlyph(name string, r wiringRow) (string, lipgloss.Style) {
	if !a.vaultUnlocked(r.vault) {
		return glyphLocked, a.style.muted
	}
	if r.disabled {
		return glyphDisabled, a.style.disabled
	}
	if r.shared {
		return glyphShared, a.style.shared
	}
	if v := a.vaultValues(r.vault)[r.key]; v != "" {
		return glyphHasValue, a.style.hasValue
	}
	return glyphNoValue, a.style.noValue
}

func (a *App) wiringValue(def registry.VariableDef, r wiringRow, w int) string {
	if !a.vaultUnlocked(r.vault) {
		return a.style.muted.Render("locked (u)")
	}
	v := a.vaultValues(r.vault)[r.key]
	if v == "" {
		return a.style.muted.Render(glyphEmptyVal)
	}
	if def.Secret && !a.revealSecrets {
		return a.style.secret.Render(glyphMaskedVal)
	}
	// Value sits on its own indented line ("    "), so it can use almost the
	// whole pane width; clipBlock guards the residual.
	return a.style.hasValue.Render(truncStr(v, max(8, w-5)))
}

func (a *App) inspectGlobal() string {
	names := a.globalNames()
	i := a.mainCursor()
	if i < 0 || i >= len(names) {
		return a.style.muted.Render("no global selected")
	}
	name := names[i]
	def := a.reg.Globals[name]
	var b strings.Builder
	b.WriteString(a.style.title.Render("global "+name) + "\n\n")
	if def.Description != "" {
		b.WriteString(kv(a, "description", def.Description) + "\n")
	}
	b.WriteString(a.style.section.Render("PER-VAULT SOURCE") + "\n")
	for _, v := range keysOf(a.reg.Vaults) {
		src := "(not for this vault)"
		if d, ok := def.Values[v]; ok {
			if d.Source == "static" {
				src = "static = " + d.Value
			} else {
				src = "runtime"
			}
		}
		b.WriteString("  " + a.style.subtle.Render(pad(v, 10)) + a.style.muted.Render(src) + "\n")
	}
	return b.String()
}

func (a *App) inspectGroup() string {
	keys := a.groupKeysFiltered()
	i := a.mainCursor()
	if i < 0 || i >= len(keys) {
		return a.style.muted.Render("no group selected")
	}
	key := keys[i]
	var b strings.Builder
	b.WriteString(a.style.title.Render("group "+key) + "\n\n")
	b.WriteString(kv(a, "title", a.reg.Groups[key].Title))
	b.WriteString("\n" + a.style.section.Render("MEMBERS") + "\n")
	for _, n := range keysOf(a.reg.Variables) {
		if a.reg.Variables[n].GroupKey == key {
			b.WriteString("  " + a.style.subtle.Render(n) + "\n")
		}
	}
	return b.String()
}

func (a *App) inspectCompose() string {
	files := a.composeFiles()
	i := a.mainCursor()
	if i < 0 || i >= len(files) {
		return a.style.muted.Render("no compose file selected")
	}
	var b strings.Builder
	b.WriteString(a.style.title.Render("compose") + "\n\n")
	b.WriteString(kv(a, "file", files[i]))
	b.WriteString("\n" + a.style.muted.Render("menv rewrites only the lines between\n# <menv:consumer> … # </menv> markers."))
	return b.String()
}

func (a *App) inspectBackup() string {
	keys := a.backupsNewestFirst()
	i := a.mainCursor()
	if i < 0 || i >= len(keys) {
		return a.style.muted.Render("no backup selected")
	}
	var b strings.Builder
	b.WriteString(a.style.title.Render("backup "+keys[i]) + "\n\n")
	b.WriteString(kv(a, "path", ".menv/backups/"+keys[i]))
	b.WriteString("\n" + a.style.muted.Render("⏎ restores this snapshot (overwrites files)."))
	return b.String()
}

// ── small render helpers ────────────────────────────────────────────────────

func consumerPathsList(def registry.ConsumerDef) []string {
	cp := generate.ConsumerPathsFor(def)
	var out []string
	out = append(out, cp.Main...)
	out = append(out, cp.Local...)
	if cp.Example != "" {
		out = append(out, cp.Example)
	}
	return out
}

func pad(s string, n int) string {
	w := lipgloss.Width(s)
	for w < n {
		s += " "
		w++
	}
	return s
}

func truncStr(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return string(r)
	}
	if n <= 1 {
		return string(r[:n])
	}
	return string(r[:n-1]) + "…"
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
