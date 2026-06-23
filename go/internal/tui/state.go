package tui

import (
	"charm.land/bubbles/v2/help"
	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"

	"github.com/nikrabaev/menv/go/internal/cli"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// pane identifies which of the three panes owns the keyboard.
type pane int

const (
	paneSidebar pane = iota
	paneMain
	paneInspector
)

// mainTab identifies the active tab in the centre pane.
type mainTab int

const (
	tabVariables mainTab = iota
	tabGlobals
	tabGroups
	tabCompose
	tabBackups
)

var allTabs = []mainTab{tabVariables, tabGlobals, tabGroups, tabCompose, tabBackups}

func (t mainTab) title() string {
	switch t {
	case tabVariables:
		return "variables"
	case tabGlobals:
		return "globals"
	case tabGroups:
		return "groups"
	case tabCompose:
		return "compose"
	case tabBackups:
		return "backups"
	}
	return ""
}

// vaultRuntime holds the per-vault unlock state and (when unlocked) a snapshot
// of its key→value store, read once at load time.
type vaultRuntime struct {
	unlocked bool
	values   map[string]string // nil when locked
}

type statusKind int

const (
	statusNone statusKind = iota
	statusOK
	statusErr
	statusInfo
)

type statusMessage struct {
	kind statusKind
	text string
}

// App is the root bubbletea model. A pointer receiver is used throughout so
// modal continuation closures can mutate state in place.
type App struct {
	ctx   *TuiContext
	style styles
	keys  keymap

	loaded bool          // whether a menv.json was found
	wizard *initWizard   // shown when !loaded
	reg    registry.Registry

	// Selection / view state.
	activeVault    string
	consumerFilter string // "" = no filter
	focus          pane
	tab            mainTab
	humanMode      bool
	humanRowFocus  bool
	humanRowIndex  int
	revealSecrets  bool
	revealConfirmed bool

	sidebarIndex   int
	mainIndex      map[mainTab]int
	inspectorIndex int

	filters      map[mainTab]string
	filterEditing bool
	filterInput   textinput.Model

	// Runtime data.
	vaults         map[string]*vaultRuntime
	findings       []cli.Finding
	findingsLoaded bool
	backups        []string

	modals []modal
	status *statusMessage
	busy   string

	spinner spinner.Model
	help    help.Model

	width  int
	height int
}

// NewAppModel constructs the root model. When loaded is false the registry is
// empty and the init wizard is shown instead of the main UI.
func NewAppModel(ctx *TuiContext, reg registry.Registry, loaded bool) *App {
	sp := spinner.New()
	sp.Spinner = spinner.Dot

	ti := textinput.New()
	ti.Prompt = "/"
	ti.Placeholder = "filter…"

	a := &App{
		ctx:       ctx,
		style:     newStyles(),
		keys:      newKeymap(),
		loaded:    loaded,
		reg:       reg,
		focus:     paneMain,
		tab:       tabVariables,
		mainIndex: map[mainTab]int{},
		filters:   map[mainTab]string{},
		vaults:    map[string]*vaultRuntime{},
		spinner:   sp,
		help:      help.New(),
		filterInput: ti,
		width:     80,
		height:    24,
	}
	if loaded {
		a.activeVault = reg.Defaults.Vault
	} else {
		a.wizard = newInitWizard()
	}
	return a
}

// Init implements tea.Model.
func (a *App) Init() tea.Cmd {
	if !a.loaded {
		return a.wizard.Init()
	}
	a.busy = "loading"
	return tea.Batch(
		a.loadVaultsCmd(),
		a.loadFindingsCmd(),
		a.loadBackupsCmd(),
		a.spinner.Tick,
	)
}

// ── small helpers ───────────────────────────────────────────────────────────

func (a *App) setStatus(kind statusKind, text string) {
	a.status = &statusMessage{kind: kind, text: text}
}

func (a *App) pushModal(m modal) tea.Cmd {
	a.modals = append(a.modals, m)
	return m.Init()
}

func (a *App) popModal() {
	if n := len(a.modals); n > 0 {
		a.modals = a.modals[:n-1]
	}
}

func (a *App) topModal() modal {
	if n := len(a.modals); n > 0 {
		return a.modals[n-1]
	}
	return nil
}

// mainCursor returns the cursor index for the active tab.
func (a *App) mainCursor() int { return a.mainIndex[a.tab] }

func (a *App) setMainCursor(i int) { a.mainIndex[a.tab] = i }

func (a *App) filter() string { return a.filters[a.tab] }

// vaultUnlocked reports whether the given vault is currently unlocked.
func (a *App) vaultUnlocked(name string) bool {
	rt, ok := a.vaults[name]
	return ok && rt.unlocked
}

// vaultValues returns the unlocked value snapshot for a vault (nil if locked).
func (a *App) vaultValues(name string) map[string]string {
	if rt, ok := a.vaults[name]; ok {
		return rt.values
	}
	return nil
}

// validateSelection resets activeVault / consumerFilter if they vanished after
// a mutation or reload.
func (a *App) validateSelection() {
	if _, ok := a.reg.Vaults[a.activeVault]; !ok {
		a.activeVault = a.reg.Defaults.Vault
	}
	if a.consumerFilter != "" {
		if _, ok := a.reg.Consumers[a.consumerFilter]; !ok {
			a.consumerFilter = ""
		}
	}
	a.clampCursors()
}
