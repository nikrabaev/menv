package tui

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

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
	case "backspace":
		return tea.KeyPressMsg{Code: tea.KeyBackspace}
	case "ctrl+r":
		return tea.KeyPressMsg{Code: 'r', Mod: tea.ModCtrl}
	}
	r := []rune(s)
	return tea.KeyPressMsg{Code: r[0], Text: s}
}

func TestKeyStrings(t *testing.T) {
	cases := []string{"n", "e", "x", "w", "u", "s", "r", "d", "g", "c", "?", "/", "[", "]", "1", "2", "3",
		"tab", "enter", "esc", "up", "down", "backspace", "ctrl+r"}
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

// TestNarrowInspectorEscapeHatch guards the bug where focus could land on the
// inspector pane while it was hidden (narrow terminal / human mode), leaving the
// user with no visible focused pane. Enter must instead open a detail modal, and
// 3 / tab / resize must never park focus on the off-screen pane.
func TestNarrowInspectorEscapeHatch(t *testing.T) {
	// Wide baseline: the inspector is on screen, so Enter focuses it directly.
	wide := newTestApp()
	wide.focus = paneMain
	wide.tab = tabVariables
	wide.setMainCursor(0)
	if !wide.inspectorVisible() {
		t.Fatal("inspector should be visible at 120 cols")
	}
	press(wide, "enter")
	if wide.topModal() != nil {
		t.Fatalf("wide: enter should not open a modal, got %T", wide.topModal())
	}
	if wide.focus != paneInspector {
		t.Fatal("wide: enter should focus the inspector pane")
	}

	// Narrow: the inspector is hidden, so Enter opens the detail modal instead
	// of focusing a pane that isn't rendered.
	a := newTestApp()
	a.Update(tea.WindowSizeMsg{Width: 80, Height: 30})
	a.focus = paneMain
	a.tab = tabVariables
	a.setMainCursor(0)
	if a.inspectorVisible() {
		t.Fatal("inspector should be hidden at 80 cols")
	}
	press(a, "enter")
	if _, ok := a.topModal().(*detailModal); !ok {
		t.Fatalf("narrow: enter should open the detail modal, got %T", a.topModal())
	}
	if a.focus == paneInspector {
		t.Fatal("narrow: focus must not move to the hidden inspector")
	}
	render(t, a, "detail modal")
	press(a, "esc")
	if a.topModal() != nil {
		t.Fatal("esc should close the detail modal")
	}

	// 3 must not jump to the hidden inspector.
	press(a, "3")
	if a.focus == paneInspector {
		t.Fatal("narrow: 3 must not focus the hidden inspector")
	}
	// tab from main skips the inspector and wraps to the sidebar.
	a.focus = paneMain
	press(a, "tab")
	if a.focus != paneSidebar {
		t.Fatalf("narrow: tab from main should skip the inspector, got %v", a.focus)
	}

	// Resizing narrow while focused on the inspector pulls focus back to main.
	b := newTestApp()
	b.focus = paneInspector
	b.Update(tea.WindowSizeMsg{Width: 80, Height: 30})
	if b.focus == paneInspector {
		t.Fatal("resize: focus should leave the now-hidden inspector")
	}
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

func TestInitWizardRenders(t *testing.T) {
	ctx := &TuiContext{Root: t_tmp, Env: map[string]string{}, Auth: map[string]string{}}
	a := NewAppModel(ctx, registry.Registry{}, false) // no registry -> wizard
	a.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
	if a.wizard == nil {
		t.Fatal("wizard should be active when no registry is loaded")
	}
	out := render(t, a, "wizard")
	if !strings.Contains(out, "menv") {
		t.Errorf("wizard should render the menv title")
	}
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

// TestPaneWidthAccounting guards the lipgloss v2 border-box regression: a pane
// must render to exactly its requested outer width (not 2 cells narrower), and
// no rendered line may exceed the terminal width at any size — content that
// overflowed the content area used to wrap, desyncing the three panes' heights.
func TestPaneWidthAccounting(t *testing.T) {
	a := newTestApp()
	for _, outer := range []int{20, 26, 40, 60} {
		if got := lipgloss.Width(a.renderPane(false, outer, 10, "content")); got != outer {
			t.Errorf("renderPane outerW=%d rendered width=%d, want %d", outer, got, outer)
		}
	}

	for _, sz := range [][2]int{{60, 14}, {80, 24}, {92, 30}, {100, 30}, {140, 40}, {200, 50}} {
		a := newTestApp()
		a.Update(tea.WindowSizeMsg{Width: sz[0], Height: sz[1]})
		a.focus = paneMain
		for _, l := range strings.Split(a.View().Content, "\n") {
			if w := lipgloss.Width(l); w > sz[0] {
				t.Fatalf("at %dx%d a line is %d cells wide (>%d): %q", sz[0], sz[1], w, sz[0], ansi.Strip(l))
			}
		}
	}
}

// TestModalNoOverflow guards against the garbled-output bug: while editing a
// value (type then delete) no rendered line may exceed the terminal width. An
// over-width line is hard-wrapped by the terminal into an extra row, which
// desyncs Bubble Tea's one-line-per-row cell model and leaves stray characters.
func TestModalNoOverflow(t *testing.T) {
	for _, sz := range [][2]int{{80, 24}, {92, 30}, {100, 30}, {140, 40}} {
		a := newTestApp()
		a.Update(tea.WindowSizeMsg{Width: sz[0], Height: sz[1]})
		a.focus = paneMain
		a.tab = tabVariables
		a.setMainCursor(0)
		a.handleKey(keyMsg("s")) // open set-value flow (fixture vault is unlocked)
		for _, k := range []string{"enter", "a", "b", "c", "backspace", "backspace"} {
			a.Update(keyMsg(k))
		}
		for _, l := range strings.Split(a.View().Content, "\n") {
			if w := lipgloss.Width(l); w > sz[0] {
				t.Fatalf("at %dx%d an edit-modal line is %d cells wide (>%d): %q",
					sz[0], sz[1], w, sz[0], ansi.Strip(l))
			}
		}
	}
}

// TestMatrixColumns checks the adaptive column sizing: the name column never
// exceeds the longest variable name, columns stay within the available width,
// and they grow to fit consumer names when there is room.
func TestMatrixColumns(t *testing.T) {
	consumers := []string{"api-gateway", "worker-service", "web-frontend"}
	// Wide pane: columns grow to fit the longest consumer name (+1).
	nameW, colW := matrixColumns(120, consumers, 18)
	if nameW != 18 {
		t.Errorf("nameW = %d, want 18 (longest var name)", nameW)
	}
	if want := len("worker-service") + 1; colW < want {
		t.Errorf("wide colW = %d, want >= %d to fit consumer names", colW, want)
	}
	if total := 2 + nameW + 3 + colW*len(consumers); total > 120 {
		t.Errorf("columns overflow: total %d > 120", total)
	}
	// Narrow pane: name column shrinks to its floor and columns stay >= 3.
	nameW, colW = matrixColumns(48, consumers, 22)
	if nameW < 12 {
		t.Errorf("narrow nameW = %d, want >= 12 floor", nameW)
	}
	if colW < 3 {
		t.Errorf("narrow colW = %d, want >= 3", colW)
	}
	if total := 2 + nameW + 3 + colW*len(consumers); total > 48 {
		t.Errorf("narrow columns overflow: total %d > 48", total)
	}
}

// TestActiveVaultMarked verifies the active vault stays marked in the sidebar
// even when the cursor (and focus) is elsewhere.
func TestActiveVaultMarked(t *testing.T) {
	a := newTestApp()
	a.focus = paneMain // cursor not on the sidebar
	out := ansi.Strip(a.renderSidebar())
	if !strings.Contains(out, glyphActiveItem+" local") {
		t.Errorf("active vault should be marked with %q in the sidebar:\n%s", glyphActiveItem, out)
	}
}

// TestCurrentVariableMarkedFromInspector verifies the variable shown in the
// inspector stays highlighted in the matrix while the inspector has focus.
func TestCurrentVariableMarkedFromInspector(t *testing.T) {
	a := newTestApp()
	a.tab = tabVariables
	a.focus = paneInspector
	name := a.selectedVariable()
	if name == "" {
		t.Fatal("expected a selected variable in the fixture")
	}
	out := ansi.Strip(a.renderVariablesMatrix(70, 40))
	if !strings.Contains(out, "▸ "+name) {
		t.Errorf("matrix should mark %q as current while inspector is focused:\n%s", name, out)
	}
}

// manyVarApp builds an app with n wired variables on an unlocked vault, for
// exercising scrolling and height-packing on lists that exceed the pane height.
func manyVarApp(n int) *App {
	a := newTestApp()
	vars := map[string]registry.VariableDef{}
	for i := 0; i < n; i++ {
		vars[fmt.Sprintf("VAR_%02d", i)] = registry.VariableDef{
			VaultMapping: map[string]map[string]registry.MappingEntry{
				"local": {"api": {Key: fmt.Sprintf("k_%02d", i)}},
			},
		}
	}
	a.reg.Variables = vars
	a.vaults["local"] = &vaultRuntime{unlocked: true, values: map[string]string{}}
	return a
}

// TestMatrixScrollsToCursor guards the bug where the variables matrix rendered
// every row unwindowed, so moving the cursor down pushed the selection off the
// bottom of the pane (clipped by clipBlock) with no way to follow it.
func TestMatrixScrollsToCursor(t *testing.T) {
	a := manyVarApp(40)
	a.Update(tea.WindowSizeMsg{Width: 100, Height: 24})
	a.focus = paneMain
	a.tab = tabVariables
	names := a.flatVariables()

	for _, idx := range []int{0, 20, len(names) - 1} {
		a.setMainCursor(idx)
		out := ansi.Strip(a.View().Content)
		if !strings.Contains(out, "▸ "+names[idx]) {
			t.Errorf("cursor %d (%s): the selected row must stay visible", idx, names[idx])
		}
	}

	// With the cursor at the bottom the first rows scroll off behind an ↑ marker.
	a.setMainCursor(len(names) - 1)
	out := ansi.Strip(a.View().Content)
	if !strings.Contains(out, "↑") {
		t.Error("a scrolled-down matrix should show an ↑ more indicator")
	}
	if strings.Contains(out, "VAR_00") {
		t.Error("the first variable should scroll off when the cursor is at the bottom")
	}
}

// TestHumanCardsFillHeight guards that human-mode cards fill the pane height.
// The previous fixed per-card estimate (h/5), and then whole-card packing, both
// left a partial card's worth of empty rows; line-level windowing fills exactly.
func TestHumanCardsFillHeight(t *testing.T) {
	a := manyVarApp(40)
	a.humanMode = true
	for _, cursor := range []int{0, 18, 39} {
		a.setMainCursor(cursor)
		const w, h = 80, 18
		if got := lipgloss.Height(a.renderVariablesCards(w, h)); got < h-1 {
			t.Errorf("cursor %d: cards filled %d of %d rows; should fill the pane", cursor, got, h)
		}
	}
}

// TestLockBadgeIsWidthOne guards issue 4: the locked-vault badge must be a
// width-1 glyph, not the width-2 🔒 emoji whose terminal width disagrees with
// lipgloss and shifted pane borders whenever a vault was locked (e.g. on load).
func TestLockBadgeIsWidthOne(t *testing.T) {
	if w := lipgloss.Width(glyphLocked); w != 1 {
		t.Fatalf("lock glyph %q must be width 1, got %d", glyphLocked, w)
	}
	a := newTestApp()
	a.busy = "loading"
	a.vaults = map[string]*vaultRuntime{
		"local":      {unlocked: false},
		"production": {unlocked: false},
	}
	out := a.View().Content
	if strings.Contains(out, "🔒") {
		t.Error("view must not contain the width-2 🔒 emoji — it shifts pane borders")
	}
	for _, l := range strings.Split(out, "\n") {
		if wd := lipgloss.Width(l); wd != 0 && wd != a.width {
			t.Errorf("locked-state line width %d != %d: %q", wd, a.width, ansi.Strip(l))
		}
	}
}

// TestPaneHasHorizontalPadding guards the 1-cell inner padding added to bordered
// panes: content is inset from the left border by a space.
func TestPaneHasHorizontalPadding(t *testing.T) {
	a := newTestApp()
	lines := strings.Split(a.renderPane(true, 24, 5, "hello"), "\n")
	if len(lines) < 2 {
		t.Fatalf("pane should render multiple rows, got %d", len(lines))
	}
	if content := ansi.Strip(lines[1]); !strings.HasPrefix(content, "│ ") {
		t.Errorf("pane content should be inset one cell from the border, got %q", content)
	}
}
