package tui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/nikrabaev/menv/internal/cli"
	"github.com/nikrabaev/menv/internal/core/ops"
	"github.com/nikrabaev/menv/internal/registry"
)

// PaneId identifies which pane has focus.
type PaneId string

const (
	PaneSidebar   PaneId = "sidebar"
	PaneMain      PaneId = "main"
	PaneInspector PaneId = "inspector"
)

// MainTab identifies the active tab in the main pane.
type MainTab string

const (
	TabVariables MainTab = "variables"
	TabGlobals   MainTab = "globals"
	TabGroups    MainTab = "groups"
	TabCompose   MainTab = "compose"
	TabBackups   MainTab = "backups"
)

var allTabs = []MainTab{TabVariables, TabGlobals, TabGroups, TabCompose, TabBackups}

// VaultRuntime holds runtime state for one vault (unlocked status + value snapshot).
type VaultRuntime struct {
	Unlocked bool
	Values   map[string]string // nil = locked
}

// StatusMsg is a transient toast shown below the header.
type StatusMsg struct {
	Text  string
	IsErr bool
}

// Modal is the interface for all modal types.
type Modal interface{ isModal() }

type HelpModal struct{}

func (HelpModal) isModal() {}

type QuitModal struct{}

func (QuitModal) isModal() {}

type FindingsModal struct{}

func (FindingsModal) isModal() {}

type GenerateModal struct {
	Consumer string
}

func (GenerateModal) isModal() {}

type PlanModal struct {
	Title  string
	Op     ops.OpResult
	Danger bool
	Forced bool
}

func (PlanModal) isModal() {}

type ConfirmModal struct {
	Title     string
	Body      string
	Danger    bool
	OnConfirm func() tea.Cmd
}

func (ConfirmModal) isModal() {}

type UnlockModal struct {
	Vault    string
	Input    textinput.Model
	ErrText  string
	Trying   bool
	OnUnlock func() tea.Cmd // called after success; may be nil
}

func (UnlockModal) isModal() {}

type FormField struct {
	Key         string
	Label       string
	Placeholder string
	Required    bool
	Secret      bool
	Choices     []string // non-empty = select list
	Value       string
}

type FormSpec struct {
	Title  string
	Fields []FormField
	Submit func(values map[string]string) tea.Cmd
}

type FormModal struct {
	Spec       FormSpec
	Inputs     []textinput.Model
	FocusIndex int
	ErrText    string
}

func (FormModal) isModal() {}

type RevealModal struct {
	Variable string
	Vault    string
	Consumer string
	Value    string
}

func (RevealModal) isModal() {}

type ConsumerPickModal struct {
	Title     string
	Consumers []string
	Index     int
	OnPick    func(consumer string) tea.Cmd
}

func (ConsumerPickModal) isModal() {}

type OrphanPromptModal struct {
	Vault    string
	Keys     []string
	OnChoose func(delete bool) tea.Cmd
}

func (OrphanPromptModal) isModal() {}

// AppState is the full application state.
type AppState struct {
	Registry registry.Registry

	ActiveVault    string
	ConsumerFilter *string
	Focus          PaneId
	Tab            MainTab

	HumanMode     bool
	HumanRowFocus bool
	HumanRowIndex int

	RevealSecrets   bool
	RevealConfirmed bool

	SidebarIndex   int
	MainIndex      map[MainTab]int
	InspectorIndex int

	Filters       map[MainTab]string
	FilterEditing bool
	FilterInput   textinput.Model

	Vaults map[string]VaultRuntime

	Findings []cli.Finding // nil = never ran
	Backups  []string
	Modals   []Modal
	Status   *StatusMsg
	Busy     *string

	// Terminal dimensions (set by tea.WindowSizeMsg)
	Width  int
	Height int

	// Loaded flag — false until initial vault loads complete
	Ready bool
}

// topModal returns the top of the modal stack (nil if empty).
func (s *AppState) topModal() Modal {
	if len(s.Modals) == 0 {
		return nil
	}
	return s.Modals[len(s.Modals)-1]
}

// pushModal adds a modal to the stack.
func (s *AppState) pushModal(m Modal) {
	s.Modals = append(s.Modals, m)
}

// popModal removes the top modal.
func (s *AppState) popModal() {
	if len(s.Modals) > 0 {
		s.Modals = s.Modals[:len(s.Modals)-1]
	}
}

func newAppState(reg registry.Registry, vaultName string) AppState {
	mainIdx := map[MainTab]int{}
	for _, t := range allTabs {
		mainIdx[t] = 0
	}
	filters := map[MainTab]string{}
	for _, t := range allTabs {
		filters[t] = ""
	}
	fi := textinput.New()
	fi.Placeholder = "filter…"
	fi.CharLimit = 80
	vaults := map[string]VaultRuntime{}
	for name := range reg.Vaults {
		vaults[name] = VaultRuntime{}
	}
	if vaultName == "" {
		vaultName = reg.Defaults.Vault
	}
	return AppState{
		Registry:     reg,
		ActiveVault:  vaultName,
		Focus:        PaneSidebar,
		Tab:          TabVariables,
		MainIndex:    mainIdx,
		Filters:      filters,
		FilterInput:  fi,
		Vaults:       vaults,
	}
}

type RegistryReloadedMsg struct{ Reg registry.Registry }

type VaultRuntimeMsg struct {
	Vault   string
	Runtime VaultRuntime
}

type AllVaultsMsg struct{ Vaults map[string]VaultRuntime }

type FindingsMsg struct{ Findings []cli.Finding }

type BackupsMsg struct{ Backups []string }

type OpAppliedMsg struct{ Reg registry.Registry }

type ErrMsg struct{ Err error }

type SetStatusMsg struct{ S *StatusMsg }

type BusyMsg struct{ Label *string }
