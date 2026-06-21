package tui

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/google/uuid"
	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/core/ops"
	"github.com/nikrabaev/menv/internal/generate"
	menvio "github.com/nikrabaev/menv/internal/io"
	"github.com/nikrabaev/menv/internal/registry"
)

// handlePaneKey routes keyboard events through global and pane-specific handlers.
func handlePaneKey(ctx *TuiContext, s *AppState, msg tea.KeyMsg) (*AppState, tea.Cmd) {
	key := msg.String()

	// Global chords always active.
	switch key {
	case "ctrl+r":
		s.RevealSecrets = !s.RevealSecrets
		return s, nil
	case "?":
		s.pushModal(HelpModal{})
		return s, nil
	case "q":
		s.pushModal(QuitModal{})
		return s, nil
	case "C":
		return s, reloadFindings(ctx, s.Registry)
	case "g":
		consumer := ""
		if s.ConsumerFilter != nil {
			consumer = *s.ConsumerFilter
		}
		s.pushModal(GenerateModal{Consumer: consumer})
		return s, nil
	case "R":
		return s, reloadRegistry(ctx)
	case "[":
		s.Tab = prevTab(s.Tab)
		return s, nil
	case "]":
		s.Tab = nextTab(s.Tab)
		return s, nil
	case "tab":
		s.Focus = nextPane(s.Focus, s.HumanMode, s.Tab)
		return s, nil
	case "shift+tab":
		s.Focus = prevPane(s.Focus, s.HumanMode, s.Tab)
		return s, nil
	case "1":
		s.Focus = PaneSidebar
		return s, nil
	case "2":
		s.Focus = PaneMain
		return s, nil
	case "3":
		if s.Tab == TabVariables {
			s.Focus = PaneInspector
		}
		return s, nil
	}

	switch s.Focus {
	case PaneSidebar:
		return handleSidebarKey(ctx, s, key)
	case PaneMain:
		return handleMainKey(ctx, s, key)
	case PaneInspector:
		return handleInspectorKey(ctx, s, key)
	}
	return s, nil
}

// ── pane navigation ───────────────────────────────────────────────────────────

func nextTab(t MainTab) MainTab {
	for i, tab := range allTabs {
		if tab == t && i+1 < len(allTabs) {
			return allTabs[i+1]
		}
	}
	return allTabs[0]
}

func prevTab(t MainTab) MainTab {
	for i, tab := range allTabs {
		if tab == t && i > 0 {
			return allTabs[i-1]
		}
	}
	return allTabs[len(allTabs)-1]
}

func nextPane(p PaneId, humanMode bool, tab MainTab) PaneId {
	if humanMode || tab != TabVariables {
		if p == PaneSidebar {
			return PaneMain
		}
		return PaneSidebar
	}
	switch p {
	case PaneSidebar:
		return PaneMain
	case PaneMain:
		return PaneInspector
	default:
		return PaneSidebar
	}
}

func prevPane(p PaneId, humanMode bool, tab MainTab) PaneId {
	if humanMode || tab != TabVariables {
		if p == PaneMain {
			return PaneSidebar
		}
		return PaneMain
	}
	switch p {
	case PaneInspector:
		return PaneMain
	case PaneMain:
		return PaneSidebar
	default:
		return PaneInspector
	}
}

// ── sidebar keys ──────────────────────────────────────────────────────────────

func buildSidebarSelectables(s *AppState) []sidebarEntry {
	all := buildSidebarEntries(s)
	var sel []sidebarEntry
	for _, e := range all {
		if e.kind != "header" {
			sel = append(sel, e)
		}
	}
	return sel
}

func handleSidebarKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	entries := buildSidebarSelectables(s)
	total := len(entries)

	switch key {
	case "j", "down":
		if s.SidebarIndex < total-1 {
			s.SidebarIndex++
		}
		return s, nil
	case "k", "up":
		if s.SidebarIndex > 0 {
			s.SidebarIndex--
		}
		return s, nil
	case "enter":
		if s.SidebarIndex < len(entries) {
			e := entries[s.SidebarIndex]
			switch e.kind {
			case "vault":
				s.ActiveVault = e.name
			case "consumer":
				if s.ConsumerFilter != nil && *s.ConsumerFilter == e.name {
					s.ConsumerFilter = nil
				} else {
					cf := e.name
					s.ConsumerFilter = &cf
				}
			}
		}
		return s, nil
	case "u":
		if s.SidebarIndex < len(entries) && entries[s.SidebarIndex].kind == "vault" {
			vaultName := entries[s.SidebarIndex].name
			inp := textinput.New()
			inp.EchoMode = textinput.EchoPassword
			inp.Placeholder = "passphrase"
			inp.Focus()
			s.pushModal(UnlockModal{Vault: vaultName, Input: inp})
		}
		return s, nil
	case "a":
		if s.SidebarIndex < len(entries) && entries[s.SidebarIndex].kind == "consumer" {
			s.pushModal(buildConsumerAddForm(ctx, s))
		} else {
			s.pushModal(buildVaultAddForm(ctx, s))
		}
		return s, nil
	case "e":
		if s.SidebarIndex < len(entries) {
			e := entries[s.SidebarIndex]
			if e.kind == "consumer" {
				s.pushModal(buildConsumerEditForm(ctx, s, e.name))
			}
		}
		return s, nil
	case "x":
		if s.SidebarIndex < len(entries) {
			e := entries[s.SidebarIndex]
			if e.kind == "consumer" {
				return planConsumerRemove(ctx, s, e.name)
			} else if e.kind == "vault" {
				return planVaultRemove(ctx, s, e.name)
			}
		}
		return s, nil
	case "D":
		if s.SidebarIndex < len(entries) && entries[s.SidebarIndex].kind == "vault" {
			vaultName := entries[s.SidebarIndex].name
			reg := s.Registry
			op, err := ops.PlanVaultUpdate(reg, ops.VaultUpdateInput{Name: vaultName, MakeDefault: true})
			if err != nil {
				s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
				return s, nil
			}
			return s, applyOp(ctx, reg, op)
		}
		return s, nil
	}
	return s, nil
}

// ── main pane keys ────────────────────────────────────────────────────────────

func handleMainKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	switch key {
	case "/":
		s.FilterEditing = true
		s.FilterInput.SetValue(s.Filters[s.Tab])
		s.FilterInput.Focus()
		return s, nil
	case "j", "down":
		s.MainIndex[s.Tab]++
		return s, nil
	case "k", "up":
		if s.MainIndex[s.Tab] > 0 {
			s.MainIndex[s.Tab]--
		}
		return s, nil
	case "enter":
		if s.Tab == TabVariables {
			s.Focus = PaneInspector
		} else if s.Tab == TabBackups {
			return startRestore(ctx, s)
		}
		return s, nil
	case "esc":
		s.Focus = PaneSidebar
		return s, nil
	}

	switch s.Tab {
	case TabVariables:
		return handleVariablesKey(ctx, s, key)
	case TabGlobals:
		return handleGlobalsKey(ctx, s, key)
	case TabGroups:
		return handleGroupsKey(ctx, s, key)
	case TabCompose:
		return handleComposeKey(ctx, s, key)
	case TabBackups:
		return handleBackupsKey(ctx, s, key)
	}
	return s, nil
}

func selectedVarName(s *AppState) string {
	rows := buildVarRows(s)
	idx := s.MainIndex[TabVariables]
	ri := 0
	for _, r := range rows {
		if r.kind == "var" {
			if ri == idx {
				return r.name
			}
			ri++
		}
	}
	return ""
}

func handleVariablesKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	switch key {
	case "n":
		s.pushModal(buildVarDefineForm(ctx, s))
		return s, nil
	case "e":
		name := selectedVarName(s)
		if name != "" {
			s.pushModal(buildVarEditForm(ctx, s, name))
		}
		return s, nil
	case "s":
		name := selectedVarName(s)
		if name != "" {
			return startSetValue(ctx, s, name, s.ActiveVault, "")
		}
		return s, nil
	case "w":
		name := selectedVarName(s)
		if name != "" {
			return startWire(ctx, s, name)
		}
		return s, nil
	case "x":
		name := selectedVarName(s)
		if name != "" {
			return planVarRemove(ctx, s, name)
		}
		return s, nil
	case "d":
		name := selectedVarName(s)
		if name != "" {
			return planToggleDisabled(ctx, s, name, s.ActiveVault, "")
		}
		return s, nil
	}
	return s, nil
}

func handleGlobalsKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	names := sortedStringKeys(s.Registry.Globals)
	idx := s.MainIndex[TabGlobals]
	var name string
	if idx < len(names) {
		name = names[idx]
	}
	switch key {
	case "n":
		s.pushModal(buildGlobalDefineForm(ctx, s))
		return s, nil
	case "e":
		if name != "" {
			s.pushModal(buildGlobalEditForm(ctx, s, name))
		}
		return s, nil
	case "x":
		if name != "" {
			return planGlobalRemove(ctx, s, name, "")
		}
		return s, nil
	}
	return s, nil
}

func handleGroupsKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	keys := sortedStringKeys(s.Registry.Groups)
	idx := s.MainIndex[TabGroups]
	var gkey string
	if idx < len(keys) {
		gkey = keys[idx]
	}
	switch key {
	case "n":
		s.pushModal(buildGroupAddForm(ctx, s))
		return s, nil
	case "e":
		if gkey != "" {
			s.pushModal(buildGroupEditForm(ctx, s, gkey))
		}
		return s, nil
	case "x":
		if gkey != "" {
			return planGroupRemove(ctx, s, gkey)
		}
		return s, nil
	}
	return s, nil
}

func handleComposeKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	files := s.Registry.Compose.Files
	idx := s.MainIndex[TabCompose]
	var file string
	if idx < len(files) {
		file = files[idx]
	}
	switch key {
	case "n":
		s.pushModal(buildComposeBindForm(ctx, s))
		return s, nil
	case "x":
		if file != "" {
			return planComposeUnbind(ctx, s, file)
		}
		return s, nil
	}
	return s, nil
}

func handleBackupsKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	switch key {
	case "n":
		return startBackup(ctx, s)
	}
	return s, nil
}

// ── inspector keys ────────────────────────────────────────────────────────────

func handleInspectorKey(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	varName := selectedVarName(s)
	if varName == "" {
		return s, nil
	}
	def := s.Registry.Variables[varName]

	type wiringRow struct{ vault, consumer string; entry registry.MappingEntry }
	var rows []wiringRow
	for _, v := range sortedStringKeys(def.VaultMapping) {
		byC := def.VaultMapping[v]
		for _, c := range sortedStringKeys(byC) {
			rows = append(rows, wiringRow{vault: v, consumer: c, entry: byC[c]})
		}
	}

	switch key {
	case "j", "down":
		if s.InspectorIndex < len(rows)-1 {
			s.InspectorIndex++
		}
		return s, nil
	case "k", "up":
		if s.InspectorIndex > 0 {
			s.InspectorIndex--
		}
		return s, nil
	case "esc":
		s.Focus = PaneMain
		return s, nil
	}

	if s.InspectorIndex >= len(rows) {
		return s, nil
	}
	row := rows[s.InspectorIndex]

	switch key {
	case "s":
		return startSetValue(ctx, s, varName, row.vault, row.consumer)
	case "d":
		return planToggleDisabled(ctx, s, varName, row.vault, row.consumer)
	case "u":
		return planUnwire(ctx, s, varName, row.vault, row.consumer)
	}
	return s, nil
}

// ── modal key handler ─────────────────────────────────────────────────────────

func handleModalKey(ctx *TuiContext, s *AppState, top Modal, msg tea.KeyMsg) (*AppState, tea.Cmd) {
	key := msg.String()
	switch m := top.(type) {
	case HelpModal:
		if key == "esc" || key == "?" {
			s.popModal()
		}
		return s, nil

	case QuitModal:
		switch key {
		case "enter":
			return s, tea.Quit
		case "esc", "q":
			s.popModal()
		}
		return s, nil

	case FindingsModal:
		if key == "esc" {
			s.popModal()
		}
		return s, nil

	case GenerateModal:
		switch key {
		case "enter":
			s.popModal()
			return s, runGenerateCmd(ctx, s, m.Consumer)
		case "esc":
			s.popModal()
		}
		return s, nil

	case PlanModal:
		switch key {
		case "enter":
			if len(m.Op.Plan.Blockers) > 0 && !m.Forced {
				break
			}
			s.popModal()
			return s, applyOpWithFileOps(ctx, s.Registry, m.Op)
		case "f":
			newModal := m
			newModal.Forced = true
			s.Modals[len(s.Modals)-1] = newModal
			return s, nil
		case "esc":
			s.popModal()
		}
		return s, nil

	case ConfirmModal:
		switch key {
		case "enter":
			s.popModal()
			if m.OnConfirm != nil {
				return s, m.OnConfirm()
			}
		case "esc":
			s.popModal()
		}
		return s, nil

	case UnlockModal:
		if key == "esc" {
			s.popModal()
			return s, nil
		}
		model, cmd := m.Input.Update(msg)
		newM := m
		newM.Input = model
		s.Modals[len(s.Modals)-1] = newM
		if key == "enter" {
			passphrase := m.Input.Value()
			vaultName := m.Vault
			return s, func() tea.Msg {
				ctx.Auth[vaultName] = passphrase
				rt := LoadVaultRuntime(ctx, s.Registry, vaultName)
				if !rt.Unlocked {
					delete(ctx.Auth, vaultName)
					return tuiErrMsg{fmt.Errorf("wrong passphrase for vault %q", vaultName)}
				}
				return VaultRuntimeMsg{Vault: vaultName, Runtime: rt}
			}
		}
		return s, cmd

	case FormModal:
		if key == "esc" {
			s.popModal()
			return s, nil
		}
		if key == "tab" || key == "shift+tab" {
			newM := m
			if key == "tab" {
				newM.FocusIndex = (m.FocusIndex + 1) % len(m.Inputs)
			} else {
				newM.FocusIndex = (m.FocusIndex - 1 + len(m.Inputs)) % len(m.Inputs)
			}
			for i := range newM.Inputs {
				if i == newM.FocusIndex {
					newM.Inputs[i].Focus()
				} else {
					newM.Inputs[i].Blur()
				}
			}
			s.Modals[len(s.Modals)-1] = newM
			return s, nil
		}
		if key == "enter" {
			vals := map[string]string{}
			for i, inp := range m.Inputs {
				vals[m.Spec.Fields[i].Key] = inp.Value()
			}
			for i, f := range m.Spec.Fields {
				if f.Required && strings.TrimSpace(m.Inputs[i].Value()) == "" {
					newM := m
					newM.ErrText = f.Label + " is required"
					s.Modals[len(s.Modals)-1] = newM
					return s, nil
				}
			}
			s.popModal()
			if m.Spec.Submit != nil {
				return s, m.Spec.Submit(vals)
			}
			return s, nil
		}
		newM := m
		newModel, cmd := newM.Inputs[newM.FocusIndex].Update(msg)
		newM.Inputs[newM.FocusIndex] = newModel
		s.Modals[len(s.Modals)-1] = newM
		return s, cmd

	case RevealModal:
		if key == "esc" {
			s.popModal()
		}
		return s, nil

	case ConsumerPickModal:
		switch key {
		case "j", "down":
			if m.Index < len(m.Consumers)-1 {
				newM := m
				newM.Index++
				s.Modals[len(s.Modals)-1] = newM
			}
		case "k", "up":
			if m.Index > 0 {
				newM := m
				newM.Index--
				s.Modals[len(s.Modals)-1] = newM
			}
		case "enter":
			consumer := ""
			if m.Index < len(m.Consumers) {
				consumer = m.Consumers[m.Index]
			}
			s.popModal()
			if m.OnPick != nil {
				return s, m.OnPick(consumer)
			}
		case "esc":
			s.popModal()
		}
		return s, nil

	case OrphanPromptModal:
		switch key {
		case "d":
			s.popModal()
			if m.OnChoose != nil {
				return s, m.OnChoose(true)
			}
		case "k":
			s.popModal()
			if m.OnChoose != nil {
				return s, m.OnChoose(false)
			}
		case "esc":
			s.popModal()
		}
		return s, nil
	}
	return s, nil
}

// ── operation helpers ─────────────────────────────────────────────────────────

func runGenerateCmd(ctx *TuiContext, s *AppState, consumer string) tea.Cmd {
	reg := s.Registry
	vaultName := s.ActiveVault
	return func() tea.Msg {
		opts := generate.GenerateOpts{Vault: vaultName, Consumer: consumer}
		sessions := map[string]core.VaultSession{}
		for _, vname := range generate.VaultsNeeded(reg, opts) {
			sess, err := OpenSession(ctx, reg, vname)
			if err == nil {
				sessions[vname] = sess
			}
		}
		defer func() {
			for _, sess := range sessions {
				_ = sess.Close()
			}
		}()
		preview, err := generate.PreviewGenerate(ctx.Root, reg, opts, sessions)
		if err != nil {
			return tuiErrMsg{err}
		}
		if err := generate.ApplyPreview(ctx.Root, preview); err != nil {
			return tuiErrMsg{err}
		}
		return SetStatusMsg{S: &StatusMsg{Text: fmt.Sprintf("generated %d file(s)", len(preview.Writes))}}
	}
}

func planVaultRemove(ctx *TuiContext, s *AppState, vaultName string) (*AppState, tea.Cmd) {
	reg := s.Registry
	op, err := ops.PlanVaultRemove(reg, struct{ Name string }{Name: vaultName})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	s.pushModal(PlanModal{Title: fmt.Sprintf("Remove vault %q", vaultName), Op: op, Danger: true})
	return s, nil
}

func planConsumerRemove(ctx *TuiContext, s *AppState, name string) (*AppState, tea.Cmd) {
	reg := s.Registry
	op, err := ops.PlanConsumerRemove(reg, ops.ConsumerRemoveInput{Name: name})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	s.pushModal(PlanModal{Title: fmt.Sprintf("Remove consumer %q", name), Op: op, Danger: true})
	return s, nil
}

func planVarRemove(ctx *TuiContext, s *AppState, name string) (*AppState, tea.Cmd) {
	reg := s.Registry
	op, err := ops.PlanVarRemove(reg, ops.VarRemoveInput{Name: name})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	s.pushModal(PlanModal{Title: fmt.Sprintf("Remove variable %q", name), Op: op, Danger: true})
	return s, nil
}

func planToggleDisabled(ctx *TuiContext, s *AppState, name, vaultName, consumer string) (*AppState, tea.Cmd) {
	def := s.Registry.Variables[name]
	byC, ok := def.VaultMapping[vaultName]
	if !ok {
		return s, nil
	}
	entry, ok := byC[consumer]
	if !ok {
		// Try any consumer if not specified.
		for c, e := range byC {
			consumer = c
			entry = e
			break
		}
	}
	reg := s.Registry
	op, err := ops.PlanSetDisabled(reg, ops.SetDisabledInput{
		Name:     name,
		Vault:    vaultName,
		Consumer: consumer,
		Disabled: !entry.Disabled,
	})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	return s, applyOp(ctx, reg, op)
}

func planUnwire(ctx *TuiContext, s *AppState, name, vaultName, consumer string) (*AppState, tea.Cmd) {
	reg := s.Registry
	op, err := ops.PlanUnwire(reg, ops.UnwireInput{
		Name:      name,
		Vault:     vaultName,
		Consumers: []string{consumer},
	})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	s.pushModal(PlanModal{Title: fmt.Sprintf("Unwire %q from %s/%s", name, vaultName, consumer), Op: op})
	return s, nil
}

func planGlobalRemove(ctx *TuiContext, s *AppState, name, vaultName string) (*AppState, tea.Cmd) {
	reg := s.Registry
	op, err := ops.PlanGlobalRemove(reg, ops.GlobalRemoveInput{Name: name, Vault: vaultName})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	s.pushModal(PlanModal{Title: fmt.Sprintf("Remove global %q", name), Op: op, Danger: true})
	return s, nil
}

func planGroupRemove(ctx *TuiContext, s *AppState, key string) (*AppState, tea.Cmd) {
	reg := s.Registry
	op, err := ops.PlanGroupRemove(reg, struct{ Key string }{Key: key})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	s.pushModal(PlanModal{Title: fmt.Sprintf("Remove group %q", key), Op: op, Danger: true})
	return s, nil
}

func planComposeUnbind(ctx *TuiContext, s *AppState, file string) (*AppState, tea.Cmd) {
	reg := s.Registry
	op, err := ops.PlanComposeUnbind(reg, struct{ File string }{File: file})
	if err != nil {
		s.Status = &StatusMsg{Text: err.Error(), IsErr: true}
		return s, nil
	}
	return s, applyOp(ctx, reg, op)
}

func startSetValue(ctx *TuiContext, s *AppState, name, vaultName, consumer string) (*AppState, tea.Cmd) {
	reg := s.Registry
	s.pushModal(newFormModal(FormSpec{
		Title: fmt.Sprintf("Set %s", name),
		Fields: []FormField{
			{Key: "value", Label: "Value", Secret: true, Required: true},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			value := vals["value"]
			return func() tea.Msg {
				op, err := ops.PlanSetValue(reg, ops.SetValueInput{
					KeyQuery: ops.KeyQuery{Name: name, Vault: vaultName, Consumer: consumer},
					Value:    value,
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	}))
	return s, nil
}

func startWire(ctx *TuiContext, s *AppState, name string) (*AppState, tea.Cmd) {
	reg := s.Registry
	activeVault := s.ActiveVault
	s.pushModal(newFormModal(FormSpec{
		Title: fmt.Sprintf("Wire %s", name),
		Fields: []FormField{
			{Key: "vault", Label: "Vault", Required: true, Value: activeVault},
			{Key: "consumers", Label: "Consumers (comma-separated)", Required: true},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			vaultName := vals["vault"]
			consumers := splitComma(vals["consumers"])
			return func() tea.Msg {
				op, err := ops.PlanWire(reg, ops.WireInput{
					Name:      name,
					Vault:     vaultName,
					Consumers: consumers,
					NewKey:    func() string { return uuid.New().String() },
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	}))
	return s, nil
}

func startRestore(ctx *TuiContext, s *AppState) (*AppState, tea.Cmd) {
	idx := s.MainIndex[TabBackups]
	if idx >= len(s.Backups) {
		return s, nil
	}
	key := s.Backups[idx]
	s.pushModal(ConfirmModal{
		Title: fmt.Sprintf("Restore backup %s", key),
		Body:  "This will overwrite current registry and vault files.",
		OnConfirm: func() tea.Cmd {
			return func() tea.Msg {
				_, err := menvio.RestoreBackup(ctx.Root, key)
				if err != nil {
					return tuiErrMsg{err}
				}
				reg, err := registry.LoadRegistry(ctx.Root)
				if err != nil {
					return tuiErrMsg{err}
				}
				return RegistryReloadedMsg{Reg: reg}
			}
		},
	})
	return s, nil
}

func startBackup(ctx *TuiContext, s *AppState) (*AppState, tea.Cmd) {
	return s, func() tea.Msg {
		key := menvio.BackupKey(time.Now())
		paths, _ := menvio.CollectBackupPaths(ctx.Root, registry.RegistryFilename, nil, nil,
			func(p string) bool { return false })
		_, err := menvio.CreateBackup(ctx.Root, key, paths)
		if err != nil {
			return tuiErrMsg{err}
		}
		return BackupsMsg{Backups: LoadBackups(ctx)}
	}
}

// ── form builders ─────────────────────────────────────────────────────────────

func newFormModal(spec FormSpec) FormModal {
	inputs := make([]textinput.Model, len(spec.Fields))
	for i, f := range spec.Fields {
		inp := textinput.New()
		inp.Placeholder = f.Placeholder
		inp.CharLimit = 256
		if f.Secret {
			inp.EchoMode = textinput.EchoPassword
		}
		if f.Value != "" {
			inp.SetValue(f.Value)
		}
		if i == 0 {
			inp.Focus()
		}
		inputs[i] = inp
	}
	return FormModal{Spec: spec, Inputs: inputs}
}

func buildVaultAddForm(ctx *TuiContext, s *AppState) FormModal {
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: "Add vault",
		Fields: []FormField{
			{Key: "name", Label: "Name (slug)", Required: true},
			{Key: "type", Label: "Type", Required: true, Value: "menv-local"},
			{Key: "config", Label: "Config (key=value,…)", Value: "filename=.menv/vault.json,encryption=true"},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				cfgMap, _ := parseConfigMap(vals["config"])
				op, err := ops.PlanVaultAdd(reg, ops.VaultAddInput{
					Name: vals["name"], VaultType: vals["type"], VaultConfig: cfgMap,
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildConsumerAddForm(ctx *TuiContext, s *AppState) FormModal {
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: "Add consumer",
		Fields: []FormField{
			{Key: "name", Label: "Name (slug)", Required: true},
			{Key: "strategy", Label: "Strategy (single/per-vault)", Required: true, Value: "single"},
			{Key: "baseDir", Label: "Base directory", Required: true},
			{Key: "filename", Label: "File name (single)", Value: ".env"},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				op, err := ops.PlanConsumerAdd(reg, ops.ConsumerAddInput{
					Name:         vals["name"],
					StrategyType: vals["strategy"],
					BaseDir:      vals["baseDir"],
					Filename:     vals["filename"],
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildConsumerEditForm(ctx *TuiContext, s *AppState, name string) FormModal {
	def := s.Registry.Consumers[name]
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: fmt.Sprintf("Edit consumer %q", name),
		Fields: []FormField{
			{Key: "baseDir", Label: "Base directory", Value: def.StrategyConfig.BaseDir},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			baseDir := vals["baseDir"]
			return func() tea.Msg {
				op, err := ops.PlanConsumerUpdate(reg, ops.ConsumerUpdateInput{
					Name:    name,
					BaseDir: &baseDir,
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildVarDefineForm(ctx *TuiContext, s *AppState) FormModal {
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: "Define variable",
		Fields: []FormField{
			{Key: "name", Label: "Name (ENV_VAR style)", Required: true},
			{Key: "description", Label: "Description"},
			{Key: "group", Label: "Group key"},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				op, err := ops.PlanVarDefine(reg, ops.VarDefineInput{
					Name:        vals["name"],
					Description: vals["description"],
					GroupKey:    vals["group"],
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildVarEditForm(ctx *TuiContext, s *AppState, name string) FormModal {
	def := s.Registry.Variables[name]
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: fmt.Sprintf("Edit variable %q", name),
		Fields: []FormField{
			{Key: "description", Label: "Description", Value: def.Description},
			{Key: "group", Label: "Group key", Value: def.GroupKey},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			desc := vals["description"]
			group := vals["group"]
			return func() tea.Msg {
				op, err := ops.PlanVarUpdate(reg, ops.VarUpdateInput{
					Name:        name,
					Description: &desc,
					GroupKey:    group,
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildGlobalDefineForm(ctx *TuiContext, s *AppState) FormModal {
	reg := s.Registry
	activeVault := s.ActiveVault
	return newFormModal(FormSpec{
		Title: "Define global",
		Fields: []FormField{
			{Key: "name", Label: "Name (ENV_VAR style)", Required: true},
			{Key: "vault", Label: "Vault", Required: true, Value: activeVault},
			{Key: "source", Label: "Source (runtime/static)", Required: true, Value: "static"},
			{Key: "value", Label: "Value (if static)"},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				op, err := ops.PlanGlobalDefine(reg, ops.GlobalWriteInput{
					Name:   vals["name"],
					Vault:  vals["vault"],
					Source: vals["source"],
					Value:  vals["value"],
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildGlobalEditForm(ctx *TuiContext, s *AppState, name string) FormModal {
	def := s.Registry.Globals[name]
	reg := s.Registry
	vault := s.ActiveVault
	source := "static"
	value := ""
	if vd, ok := def.Values[vault]; ok {
		source = vd.Source
		value = vd.Value
	}
	return newFormModal(FormSpec{
		Title: fmt.Sprintf("Edit global %q", name),
		Fields: []FormField{
			{Key: "vault", Label: "Vault", Required: true, Value: vault},
			{Key: "source", Label: "Source (runtime/static)", Required: true, Value: source},
			{Key: "value", Label: "Value (if static)", Value: value},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				op, err := ops.PlanGlobalUpdate(reg, ops.GlobalWriteInput{
					Name:   name,
					Vault:  vals["vault"],
					Source: vals["source"],
					Value:  vals["value"],
				})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildGroupAddForm(ctx *TuiContext, s *AppState) FormModal {
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: "Add group",
		Fields: []FormField{
			{Key: "key", Label: "Key (slug)", Required: true},
			{Key: "title", Label: "Title", Required: true},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				op, err := ops.PlanGroupAdd(reg, struct{ Key, Title string }{Key: vals["key"], Title: vals["title"]})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildGroupEditForm(ctx *TuiContext, s *AppState, key string) FormModal {
	def := s.Registry.Groups[key]
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: fmt.Sprintf("Edit group %q", key),
		Fields: []FormField{
			{Key: "title", Label: "Title", Required: true, Value: def.Title},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				op, err := ops.PlanGroupUpdate(reg, struct{ Key, Title string }{Key: key, Title: vals["title"]})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

func buildComposeBindForm(ctx *TuiContext, s *AppState) FormModal {
	reg := s.Registry
	return newFormModal(FormSpec{
		Title: "Bind compose file",
		Fields: []FormField{
			{Key: "file", Label: "Path (relative to repo root)", Required: true},
		},
		Submit: func(vals map[string]string) tea.Cmd {
			return func() tea.Msg {
				op, err := ops.PlanComposeBind(reg, struct{ File string }{File: vals["file"]})
				if err != nil {
					return tuiErrMsg{err}
				}
				return applyOp(ctx, reg, op)()
			}
		},
	})
}

// ── utilities ─────────────────────────────────────────────────────────────────

func splitComma(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func parseConfigMap(raw string) (map[string]any, error) {
	m := map[string]any{}
	for _, part := range splitComma(raw) {
		idx := strings.IndexByte(part, '=')
		if idx < 1 {
			continue
		}
		k := strings.TrimSpace(part[:idx])
		v := strings.TrimSpace(part[idx+1:])
		switch v {
		case "true":
			m[k] = true
		case "false":
			m[k] = false
		default:
			m[k] = v
		}
	}
	return m, nil
}

// Ensure time is used.
var _ = time.Now
