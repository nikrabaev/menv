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
		inspectorW = 36
	}
	mainW := a.width - sidebarW - inspectorW

	parts := []string{
		a.renderPane(a.focus == paneSidebar, sidebarW, bodyH, a.renderSidebar()),
		a.renderPane(a.focus == paneMain, mainW, bodyH, a.renderMainPane(mainW-2, bodyH-2)),
	}
	if inspectorW > 0 {
		parts = append(parts, a.renderPane(a.focus == paneInspector, inspectorW, bodyH, a.renderInspector(inspectorW-2)))
	}
	body := lipgloss.JoinHorizontal(lipgloss.Top, parts...)
	return lipgloss.JoinVertical(lipgloss.Left, header, status, body, footer)
}

func (a *App) renderPane(focused bool, outerW, outerH int, content string) string {
	innerW, innerH := outerW-2, outerH-2
	st := a.style.paneBlur
	if focused {
		st = a.style.paneFocus
	}
	return st.Width(innerW).Height(innerH).Render(clipBlock(content, innerW, innerH))
}

// clipBlock truncates each line to w cells (ANSI-aware, no wrapping) and caps
// the number of lines at h, so pane content never wraps or overflows.
func clipBlock(s string, w, h int) string {
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
		vault += " " + a.style.badge.Render(glyphLockBadge)
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
	if a.busy != "" {
		return a.style.statusBusy.Render(a.spinner.View() + " " + a.busy + "…")
	}
	if a.status != nil {
		switch a.status.kind {
		case statusOK:
			return a.style.statusOK.Render("✔ " + a.status.text)
		case statusErr:
			return a.style.statusErr.Render("✖ " + a.status.text)
		default:
			return a.style.muted.Render(a.status.text)
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
			return a.style.statusErr.Render(fmt.Sprintf("✖ %d error(s) — c to view", n))
		}
		return a.style.statusOK.Render("✔ all checks passed")
	}
	return a.style.muted.Render("ready")
}

func (a *App) renderFooter() string {
	if a.filterEditing {
		return a.filterInput.View()
	}
	return a.help.ShortHelpView(a.footerBindings())
}

// ── sidebar ─────────────────────────────────────────────────────────────────

func (a *App) renderSidebar() string {
	var b strings.Builder
	for i, it := range a.sidebarItems() {
		var line string
		switch it.kind {
		case sbHeader:
			line = a.style.section.Render(it.text)
		case sbPlaceholder:
			line = a.style.muted.Render(it.text)
		default:
			line = a.style.subtle.Render(it.text)
		}
		if a.focus == paneSidebar && i == a.sidebarIndex && (it.kind == sbVault || it.kind == sbConsumer) {
			line = a.style.keyCap.Render("▸ ") + a.style.title.Render(it.text)
		}
		b.WriteString(line + "\n")
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
		return a.renderVariablesMatrix(w)
	case tabGlobals:
		return a.renderGlobals(w)
	case tabGroups:
		return a.renderGroups(w)
	case tabCompose:
		return a.renderCompose(w)
	case tabBackups:
		return a.renderBackups(w)
	}
	return ""
}

func (a *App) renderVariablesMatrix(w int) string {
	consumers := a.activeVaultConsumers()
	nameW := 22
	var b strings.Builder
	head := "  " + pad("VARIABLE", nameW) + " S "
	for _, c := range consumers {
		head += pad(short(c, 2), 3)
	}
	b.WriteString(a.style.section.Render(head) + "\n")

	groups := a.groupedVariables()
	if len(groups) == 0 {
		msg := "no variables — n to define"
		if a.filter() != "" || a.consumerFilter != "" {
			msg = "no variables match — esc clears the filter"
		}
		b.WriteString(a.style.muted.Render(msg))
		return b.String()
	}
	idx := 0
	for _, g := range groups {
		b.WriteString(a.style.section.Render("── "+g.title+" ──") + "\n")
		for _, name := range g.vars {
			def := a.reg.Variables[name]
			selected := a.focus == paneMain && idx == a.mainCursor()
			cursor := "  "
			nameStyle := a.style.subtle
			if selected {
				cursor = a.style.keyCap.Render("▸ ")
				nameStyle = a.style.title
			}
			secret := " "
			if def.Secret {
				secret = a.style.secret.Render(glyphSecret)
			}
			row := cursor + nameStyle.Render(pad(truncStr(name, nameW), nameW)) + " " + secret + " "
			for _, c := range consumers {
				gl, st := a.cellGlyph(name, c)
				row += " " + st.Render(gl) + " "
			}
			b.WriteString(row + "\n")
			idx++
		}
	}
	return b.String()
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
	per := 5
	win := h / per
	if win < 1 {
		win = 1
	}
	start := a.mainCursor() - win/2
	if start < 0 {
		start = 0
	}
	end := start + win
	if end > len(vars) {
		end = len(vars)
		start = max(0, end-win)
	}
	var b strings.Builder
	if start > 0 {
		b.WriteString(a.style.muted.Render(fmt.Sprintf("↑ %d more", start)) + "\n")
	}
	for i := start; i < end; i++ {
		b.WriteString(a.renderCard(vars[i], i == a.mainCursor(), w))
	}
	if end < len(vars) {
		b.WriteString(a.style.muted.Render(fmt.Sprintf("↓ %d more", len(vars)-end)))
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

func (a *App) renderGlobals(w int) string {
	names := a.globalNames()
	var b strings.Builder
	b.WriteString(a.style.section.Render("  "+pad("GLOBAL", 22)+"SOURCE") + "\n")
	if len(names) == 0 {
		b.WriteString(a.style.muted.Render("no globals — n to define"))
		return b.String()
	}
	for i, n := range names {
		selected := a.focus == paneMain && i == a.mainCursor()
		cursor, ns := "  ", a.style.subtle
		if selected {
			cursor, ns = a.style.keyCap.Render("▸ "), a.style.title
		}
		b.WriteString(cursor + ns.Render(pad(truncStr(n, 22), 22)) + a.style.muted.Render(a.globalSource(n)) + "\n")
	}
	return b.String()
}

func (a *App) renderGroups(w int) string {
	keys := a.groupKeysFiltered()
	var b strings.Builder
	b.WriteString(a.style.section.Render("  "+pad("KEY", 16)+pad("TITLE", 24)+"#") + "\n")
	if len(keys) == 0 {
		b.WriteString(a.style.muted.Render("no groups — n to add"))
		return b.String()
	}
	for i, k := range keys {
		selected := a.focus == paneMain && i == a.mainCursor()
		cursor, ns := "  ", a.style.subtle
		if selected {
			cursor, ns = a.style.keyCap.Render("▸ "), a.style.title
		}
		b.WriteString(cursor + ns.Render(pad(truncStr(k, 16), 16)) +
			a.style.subtle.Render(pad(truncStr(a.reg.Groups[k].Title, 24), 24)) +
			a.style.muted.Render(fmt.Sprintf("%d", a.groupMemberCount(k))) + "\n")
	}
	return b.String()
}

func (a *App) renderCompose(w int) string {
	files := a.composeFiles()
	var b strings.Builder
	b.WriteString(a.style.section.Render("  "+pad("FILE", 34)+"STATUS") + "\n")
	if len(files) == 0 {
		b.WriteString(a.style.muted.Render("no compose files bound — n to bind"))
		return b.String()
	}
	for i, f := range files {
		selected := a.focus == paneMain && i == a.mainCursor()
		cursor, ns := "  ", a.style.subtle
		if selected {
			cursor, ns = a.style.keyCap.Render("▸ "), a.style.title
		}
		status := a.composeStatus(f)
		statusStyle := a.style.statusOK
		if strings.HasPrefix(status, "✖") {
			statusStyle = a.style.blocker
		} else if strings.HasPrefix(status, "⚠") {
			statusStyle = a.style.warning
		}
		b.WriteString(cursor + ns.Render(pad(truncStr(f, 34), 34)) + statusStyle.Render(status) + "\n")
	}
	return b.String()
}

func (a *App) renderBackups(w int) string {
	keys := a.backupsNewestFirst()
	var b strings.Builder
	b.WriteString(a.style.section.Render("  "+pad("BACKUP", 20)+"PATH") + "\n")
	if len(keys) == 0 {
		b.WriteString(a.style.muted.Render("no backups — n to create one"))
		return b.String()
	}
	for i, k := range keys {
		selected := a.focus == paneMain && i == a.mainCursor()
		cursor, ns := "  ", a.style.subtle
		if selected {
			cursor, ns = a.style.keyCap.Render("▸ "), a.style.title
		}
		b.WriteString(cursor + ns.Render(pad(k, 20)) + a.style.muted.Render(".menv/backups/"+k) + "\n")
	}
	return b.String()
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
		return a.inspectVariable()
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

func (a *App) inspectVariable() string {
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
	for i, r := range rows {
		cursor := "  "
		if a.focus == paneInspector && i == a.inspectorIndex {
			cursor = a.style.keyCap.Render("▸ ")
		}
		gl, st := a.wiringGlyph(name, r)
		val := a.wiringValue(def, r)
		shared := ""
		if r.shared {
			shared = a.style.shared.Render(" ⧉")
		}
		b.WriteString(cursor + st.Render(gl) + " " +
			a.style.subtle.Render(r.vault+"/"+r.consumer) + shared + " " + val + "\n")
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

func (a *App) wiringValue(def registry.VariableDef, r wiringRow) string {
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
	return a.style.hasValue.Render(truncStr(v, 24))
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

func short(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n])
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
