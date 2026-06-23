package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"

	"github.com/nikrabaev/menv/go/internal/registry"
	"github.com/nikrabaev/menv/go/tests/helpers"
)

// keyMsg builds a v2 KeyPressMsg whose String() matches s for the keys the TUI
// binds. The TestKeyStrings sub-test validates these constructions.
func keyMsg(s string) tea.KeyPressMsg {
	switch s {
	case "tab":
		return tea.KeyPressMsg{Code: tea.KeyTab}
	case "enter":
		return tea.KeyPressMsg{Code: tea.KeyEnter}
	case "esc":
		return tea.KeyPressMsg{Code: tea.KeyEscape}
	case "up":
		return tea.KeyPressMsg{Code: tea.KeyUp}
	case "down":
		return tea.KeyPressMsg{Code: tea.KeyDown}
	case "ctrl+r":
		return tea.KeyPressMsg{Code: 'r', Mod: tea.ModCtrl}
	}
	r := []rune(s)
	return tea.KeyPressMsg{Code: r[0], Text: s}
}

func TestKeyStrings(t *testing.T) {
	cases := []string{"n", "e", "x", "w", "u", "s", "r", "d", "g", "c", "?", "/", "[", "]", "1", "2", "3",
		"tab", "enter", "esc", "up", "down", "ctrl+r"}
	for _, c := range cases {
		if got := keyMsg(c).String(); got != c {
			t.Errorf("keyMsg(%q).String() = %q, want %q", c, got, c)
		}
	}
}

func testRegistry() registry.Registry {
	r := helpers.MakeRegistry()
	r.Variables = map[string]registry.VariableDef{
		"DATABASE_URL": {
			GroupKey: "db",
			VaultMapping: map[string]map[string]registry.MappingEntry{
				"local": {"api": {Key: "k_db"}, "web": {Key: "k_db"}},
			},
		},
		"API_TOKEN": {
			Secret: true,
			VaultMapping: map[string]map[string]registry.MappingEntry{
				"local": {"api": {Key: "k_tok"}},
			},
		},
		"PORT": {VaultMapping: map[string]map[string]registry.MappingEntry{}},
	}
	return r
}

func newTestApp() *App {
	ctx := &TuiContext{Root: t_tmp, Env: map[string]string{}, Auth: map[string]string{}}
	a := NewAppModel(ctx, testRegistry(), true)
	a.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	a.vaults["local"] = &vaultRuntime{unlocked: true, values: map[string]string{
		"k_db": "postgres://localhost/db", "k_tok": "supersecret",
	}}
	a.vaults["production"] = &vaultRuntime{unlocked: false}
	return a
}

const t_tmp = "/tmp/menv-tui-test-nonexistent"

// render asserts the View renders to non-empty content without panicking.
func render(t *testing.T, a *App, ctx string) string {
	t.Helper()
	v := a.View()
	if strings.TrimSpace(v.Content) == "" {
		t.Fatalf("%s: View() produced empty content", ctx)
	}
	if !v.AltScreen {
		t.Fatalf("%s: View() should request alt screen", ctx)
	}
	return v.Content
}

func press(a *App, s string) {
	a.Update(keyMsg(s))
}

func TestRendersAllTabsAndPanes(t *testing.T) {
	a := newTestApp()
	out := render(t, a, "initial")
	if !strings.Contains(out, "menv") {
		t.Fatalf("header missing 'menv': %q", out[:min(200, len(out))])
	}
	for _, tab := range []string{"globals", "groups", "compose", "backups", "variables"} {
		press(a, "]")
		got := render(t, a, "tab "+tab)
		if !strings.Contains(got, tab) {
			t.Errorf("tab bar should mention %q", tab)
		}
	}
	// cycle panes
	for i := 0; i < 4; i++ {
		press(a, "tab")
		render(t, a, "pane cycle")
	}
	// jump panes
	for _, p := range []string{"1", "2", "3"} {
		press(a, p)
		render(t, a, "pane "+p)
	}
}

func TestVariableNavigationAndModes(t *testing.T) {
	a := newTestApp()
	a.focus = paneMain
	press(a, "down")
	press(a, "down")
	render(t, a, "matrix nav")
	// human mode
	press(a, "H")
	if !a.humanMode {
		t.Fatal("H should enable human mode")
	}
	render(t, a, "human cards")
	press(a, "enter") // expand card row table
	render(t, a, "card row focus")
	press(a, "esc")
	press(a, "H")
	// reveal toggle (first time → confirm modal)
	press(a, "ctrl+r")
	render(t, a, "reveal confirm")
	press(a, "y")
	if !a.revealSecrets {
		t.Fatal("reveal should be on after confirm")
	}
	render(t, a, "revealed")
}

func TestModalsOpenAndRender(t *testing.T) {
	a := newTestApp()
	a.focus = paneMain

	// help
	press(a, "?")
	if _, ok := a.topModal().(*helpModal); !ok {
		t.Fatal("? should open help modal")
	}
	render(t, a, "help modal")
	press(a, "esc")
	if a.topModal() != nil {
		t.Fatal("esc should close help modal")
	}

	// quit modal
	press(a, "q")
	if _, ok := a.topModal().(quitModal); !ok {
		t.Fatal("q should open quit modal")
	}
	render(t, a, "quit modal")
	press(a, "n")
	if a.topModal() != nil {
		t.Fatal("n should dismiss quit modal")
	}

	// define variable form
	press(a, "n")
	if _, ok := a.topModal().(*formModal); !ok {
		t.Fatal("n should open a form modal")
	}
	render(t, a, "define var form")
	press(a, "esc")
}

func TestFilterEditing(t *testing.T) {
	a := newTestApp()
	a.focus = paneMain
	press(a, "/")
	if !a.filterEditing {
		t.Fatal("/ should start filter editing")
	}
	a.Update(keyMsg("A"))
	a.Update(keyMsg("P"))
	render(t, a, "filtering")
	press(a, "enter")
	if a.filterEditing {
		t.Fatal("enter should end filter editing")
	}
	if a.filters[tabVariables] != "AP" {
		t.Fatalf("filter text = %q, want AP", a.filters[tabVariables])
	}
}

func TestSidebarVaultAndConsumer(t *testing.T) {
	a := newTestApp()
	a.focus = paneSidebar
	render(t, a, "sidebar")
	// move to a vault entry and select it
	for i := 0; i < 8; i++ {
		press(a, "down")
		render(t, a, "sidebar nav")
	}
	// open add-vault form from a vault entry
	a.sidebarIndex = 1 // first vault
	press(a, "a")
	if _, ok := a.topModal().(*formModal); !ok {
		t.Fatal("a on a vault should open the add-vault form")
	}
	press(a, "esc")
}

func TestSetValueFlowOnUnlockedVault(t *testing.T) {
	a := newTestApp()
	a.focus = paneMain
	// cursor on a variable; trigger set value (vault already unlocked in fixture)
	a.tab = tabVariables
	a.setMainCursor(0)
	cmd := a.handleKey(keyMsg("s"))
	_ = cmd
	// API_TOKEN/DATABASE_URL have a consumer; a set-value form should be on top
	if a.topModal() == nil {
		t.Fatal("s should open a flow modal (consumer pick or value form)")
	}
	render(t, a, "set value flow")
}
