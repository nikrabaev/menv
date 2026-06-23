package tui

import (
	"charm.land/bubbles/v2/key"
)

// keymap holds every binding. Footer hints and the help screen are derived from
// these so there is one source of truth for "what key does what".
type keymap struct {
	// movement / panes
	up, down, enter, esc key.Binding
	tab, prevTab, nextTab key.Binding
	pane1, pane2, pane3   key.Binding
	// global
	help, quit, reveal, check, generate, reload, human, importDotenv, filter key.Binding
	// entity actions
	add, edit, remove, define, wire, unwire, setVal, getReveal, toggle key.Binding
	setDefault, unlock                                                   key.Binding
	newItem, restore                                                     key.Binding
}

func newKeymap() keymap {
	b := func(keys string, help string, k ...string) key.Binding {
		return key.NewBinding(key.WithKeys(k...), key.WithHelp(keys, help))
	}
	return keymap{
		up:      b("↑/k", "up", "up", "k"),
		down:    b("↓/j", "down", "down", "j"),
		enter:   b("⏎", "select", "enter"),
		esc:     b("esc", "back", "esc"),
		tab:     b("tab", "cycle pane", "tab"),
		prevTab: b("[", "prev tab", "["),
		nextTab: b("]", "next tab", "]"),
		pane1:   b("1", "sidebar", "1"),
		pane2:   b("2", "main", "2"),
		pane3:   b("3", "inspector", "3"),

		help:         b("?", "help", "?"),
		quit:         b("q", "quit", "q"),
		reveal:       b("^r", "reveal", "ctrl+r"),
		check:        b("c", "check", "c"),
		generate:     b("g", "generate", "g"),
		reload:       b("R", "reload", "R"),
		human:        b("H", "layout", "H"),
		importDotenv: b("i", "import", "i"),
		filter:       b("/", "filter", "/"),

		add:        b("a", "add", "a"),
		edit:       b("e", "edit", "e"),
		remove:     b("x", "remove", "x"),
		define:     b("n", "define", "n"),
		wire:       b("w", "wire", "w"),
		unwire:     b("u", "unwire", "u"),
		setVal:     b("s", "set", "s"),
		getReveal:  b("r", "reveal", "r"),
		toggle:     b("d", "disable", "d"),
		setDefault: b("D", "default", "D"),
		unlock:     b("u", "unlock", "u"),
		newItem:    b("n", "new", "n"),
		restore:    b("⏎", "restore", "enter"),
	}
}

// footerBindings returns up to ~6 context-sensitive hints; help/quit are always
// appended by the renderer. The reveal hint is suppressed once secrets are
// already revealed.
func (a *App) footerBindings() []key.Binding {
	k := a.keys
	var out []key.Binding

	switch {
	case a.filterEditing:
		return []key.Binding{a.keys.enter, a.keys.esc}
	case a.focus == paneSidebar:
		item := a.currentSidebarItem()
		switch item.kind {
		case sbVault:
			out = []key.Binding{k.enter, k.unlock, k.add, k.edit, k.setDefault, k.remove}
		case sbConsumer:
			out = []key.Binding{k.enter, k.add, k.edit, k.remove}
		default:
			out = []key.Binding{k.add}
		}
	case a.focus == paneMain:
		switch a.tab {
		case tabVariables:
			if a.humanMode {
				out = []key.Binding{k.define, k.wire, k.setVal, k.getReveal, k.toggle, k.human}
			} else {
				out = []key.Binding{k.define, k.edit, k.wire, k.setVal, k.getReveal, k.enter}
			}
		case tabGlobals, tabGroups:
			out = []key.Binding{k.define, k.edit, k.remove}
		case tabCompose:
			out = []key.Binding{k.define, k.remove}
		case tabBackups:
			out = []key.Binding{k.newItem, k.restore}
		}
	case a.focus == paneInspector:
		out = []key.Binding{k.setVal, k.getReveal, k.toggle, k.unwire, k.wire, k.esc}
	}

	// global affordances
	out = append(out, k.generate, k.check)
	if !a.revealSecrets {
		out = append(out, k.reveal)
	}
	out = append(out, k.help, k.quit)
	return out
}

// helpSections returns the grouped keybinding reference for the help modal.
func helpSections() []struct {
	title string
	rows  [][2]string
} {
	return []struct {
		title string
		rows  [][2]string
	}{
		{"Panes & navigation", [][2]string{
			{"tab", "cycle sidebar → main → inspector"},
			{"1 / 2 / 3", "jump to sidebar / main / inspector"},
			{"[ / ]", "previous / next tab"},
			{"↑/k ↓/j", "move cursor"},
			{"⏎", "select / open / drill in"},
			{"esc", "back / cancel"},
			{"/", "filter the current tab"},
		}},
		{"Global", [][2]string{
			{"^r", "toggle reveal secrets"},
			{"g", "generate .env files"},
			{"c", "run menv check"},
			{"R", "reload from disk"},
			{"H", "toggle variable layout (matrix / cards)"},
			{"i", "import a dotenv file"},
			{"? ", "this help"},
			{"q", "quit"},
		}},
		{"Sidebar — vault", [][2]string{
			{"⏎", "make active vault"},
			{"u", "unlock"},
			{"a / e", "add / edit vault"},
			{"D", "set as default"},
			{"x", "remove"},
		}},
		{"Sidebar — consumer", [][2]string{
			{"⏎", "toggle consumer filter"},
			{"a / e / x", "add / edit / remove"},
		}},
		{"Variables", [][2]string{
			{"n", "define"},
			{"e", "edit metadata"},
			{"x", "remove"},
			{"w / u", "wire / unwire"},
			{"s", "set value"},
			{"r", "reveal value"},
			{"d", "toggle disabled"},
		}},
		{"Globals / Groups / Compose", [][2]string{
			{"n", "define / add / bind"},
			{"e", "edit"},
			{"x", "remove / unbind"},
		}},
		{"Backups", [][2]string{
			{"n", "create a backup now"},
			{"⏎", "restore the selected backup"},
		}},
	}
}

// glyphLegend documents the matrix glyphs.
func glyphLegend() [][2]string {
	return [][2]string{
		{glyphUnwired, "unwired"},
		{glyphNoValue, "wired, no value"},
		{glyphHasValue, "wired, has value"},
		{glyphShared, "shared key"},
		{glyphDisabled, "disabled"},
		{glyphLocked, "vault locked"},
		{glyphSecret, "secret"},
	}
}
