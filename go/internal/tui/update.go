package tui

import (
	"fmt"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
)

// Update implements tea.Model. Message routing precedence: always-on async
// results → wizard → top modal → filter editing → pane key handling.
func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch m := msg.(type) {
	case tea.WindowSizeMsg:
		a.width, a.height = m.Width, m.Height
		a.help.SetWidth(m.Width)
		a.normalizeFocus()
	case spinner.TickMsg:
		if a.spinnerActive() {
			var c tea.Cmd
			a.spinner, c = a.spinner.Update(m)
			cmds = append(cmds, c)
		}
	case vaultsLoadedMsg:
		a.vaults = m.runtimes
		a.busy = ""
		a.clampCursors()
		return a, tea.Batch(cmds...)
	case backupsMsg:
		a.backups = m.keys
		a.clampCursors()
		return a, tea.Batch(cmds...)
	case findingsMsg:
		a.findings = m.findings
		a.findingsLoaded = true
		if a.busy == "checking" || a.busy == "loading" {
			a.busy = ""
		}
		if m.err != nil {
			a.setStatus(statusErr, m.err.Error())
		}
		if m.openModal {
			cmds = append(cmds, a.pushModal(newFindingsModal(a)))
		}
		return a, tea.Batch(cmds...)
	case registryReloadedMsg:
		if m.err != nil {
			a.setStatus(statusErr, m.err.Error())
			return a, tea.Batch(cmds...)
		}
		a.reg = m.reg
		a.validateSelection()
		cmds = append(cmds, a.loadVaultsCmd(), a.loadFindingsCmd())
		return a, tea.Batch(cmds...)
	case unlockResultMsg:
		return a, a.handleUnlockResult(m)
	case appliedMsg:
		a.busy = ""
		if m.err != nil {
			a.setStatus(statusErr, m.err.Error())
		} else {
			a.setStatus(statusOK, m.label)
		}
		cmds = append(cmds, a.refreshAfterApply())
		return a, tea.Batch(cmds...)
	case backupCreatedMsg:
		a.busy = ""
		if m.err != nil {
			a.setStatus(statusErr, m.err.Error())
		} else {
			a.setStatus(statusOK, fmt.Sprintf("backup created (%d files)", m.count))
		}
		cmds = append(cmds, a.loadBackupsCmd())
		return a, tea.Batch(cmds...)
	case restoredMsg:
		a.busy = ""
		if m.err != nil {
			a.setStatus(statusErr, m.err.Error())
		} else {
			a.setStatus(statusOK, fmt.Sprintf("restored %d file(s)", m.count))
		}
		cmds = append(cmds, a.refreshAfterApply())
		return a, tea.Batch(cmds...)
	case statusOnlyMsg:
		a.setStatus(m.kind, m.text)
		return a, tea.Batch(cmds...)
	}

	// Init wizard owns everything until a registry exists.
	if a.wizard != nil {
		cmds = append(cmds, a.wizard.Update(a, msg))
		return a, tea.Batch(cmds...)
	}

	// Topmost modal consumes input (and modal-specific async msgs).
	if top := a.topModal(); top != nil {
		cmds = append(cmds, top.Update(a, msg))
		return a, tea.Batch(cmds...)
	}

	// Inline filter editing.
	if a.filterEditing {
		cmds = append(cmds, a.updateFilter(msg))
		return a, tea.Batch(cmds...)
	}

	if k, ok := msg.(tea.KeyPressMsg); ok {
		cmds = append(cmds, a.handleKey(k))
	}
	return a, tea.Batch(cmds...)
}

// spinnerActive reports whether anything on screen needs the spinner ticking.
func (a *App) spinnerActive() bool {
	if a.busy != "" {
		return true
	}
	switch m := a.topModal().(type) {
	case *generateModal:
		return m.phase == genLoading || m.phase == genApplying
	case *unlockModal:
		return m.pending
	}
	return false
}

func (a *App) handleUnlockResult(m unlockResultMsg) tea.Cmd {
	top, isUnlock := a.topModal().(*unlockModal)
	if m.ok {
		a.ctx.Auth[m.vault] = m.secret
		a.vaults[m.vault] = &vaultRuntime{unlocked: true, values: m.values}
		a.setStatus(statusOK, "unlocked "+m.vault)
		var cont func(a *App) tea.Cmd
		if isUnlock && top.vault == m.vault {
			cont = top.onUnlocked
			a.popModal()
		}
		cmds := []tea.Cmd{a.loadFindingsCmd()}
		if cont != nil {
			cmds = append(cmds, cont(a))
		}
		return tea.Batch(cmds...)
	}
	if isUnlock && top.vault == m.vault {
		nm := a.newUnlockModal(top.vault, top.onUnlocked)
		nm.errText = "wrong passphrase — try again"
		a.modals[len(a.modals)-1] = nm
		return nm.Init()
	}
	a.setStatus(statusErr, "unlock failed")
	return nil
}

// updateFilter drives the inline "/" filter input.
func (a *App) updateFilter(msg tea.Msg) tea.Cmd {
	if k, ok := msg.(tea.KeyPressMsg); ok {
		switch k.String() {
		case "enter", "esc":
			a.filterEditing = false
			a.filterInput.Blur()
			a.setMainCursor(0)
			return nil
		}
	}
	var cmd tea.Cmd
	a.filterInput, cmd = a.filterInput.Update(msg)
	a.filters[a.tab] = a.filterInput.Value()
	a.setMainCursor(0)
	return cmd
}

// ── key handling ────────────────────────────────────────────────────────────

func (a *App) handleKey(k tea.KeyPressMsg) tea.Cmd {
	a.status = nil
	s := k.String()

	// global, always available
	switch s {
	case "ctrl+c":
		return tea.Quit
	case "q":
		return a.pushModal(quitModal{})
	case "?":
		return a.pushModal(newHelpModal(a))
	case "ctrl+r":
		return a.toggleReveal()
	case "c":
		a.busy = "checking"
		return tea.Batch(a.checkCmd(), a.spinner.Tick)
	case "g":
		return a.generateFlow()
	case "R":
		a.busy = "loading"
		return tea.Batch(a.reloadRegistryCmd(), a.loadBackupsCmd(), a.spinner.Tick)
	case "H":
		a.humanMode = !a.humanMode
		a.humanRowFocus = false
		a.normalizeFocus()
		return nil
	case "i":
		return a.importFlow()
	case "/":
		if a.focus == paneMain {
			a.filterEditing = true
			a.filterInput.SetValue(a.filter())
			return a.filterInput.Focus()
		}
		return nil
	case "[":
		a.cycleTab(-1)
		return nil
	case "]":
		a.cycleTab(1)
		return nil
	case "tab":
		a.cyclePane()
		return nil
	case "1":
		a.focus = paneSidebar
		return nil
	case "2":
		a.focus = paneMain
		return nil
	case "3":
		if a.inspectorVisible() {
			a.focus = paneInspector
		}
		return nil
	}

	switch a.focus {
	case paneSidebar:
		return a.handleSidebarKey(s)
	case paneMain:
		return a.handleMainKey(s)
	case paneInspector:
		return a.handleInspectorKey(s)
	}
	return nil
}

func (a *App) toggleReveal() tea.Cmd {
	if a.revealSecrets {
		a.revealSecrets = false
		return nil
	}
	if !a.revealConfirmed {
		return a.pushModal(&confirmModal{
			title:  "Reveal secrets?",
			body:   "Unmask secret values for this session.",
			danger: true,
			onYes: func(a *App) tea.Cmd {
				a.revealConfirmed = true
				a.revealSecrets = true
				return nil
			},
		})
	}
	a.revealSecrets = true
	return nil
}

func (a *App) cycleTab(delta int) {
	i := int(a.tab) + delta
	n := len(allTabs)
	i = (i%n + n) % n
	a.tab = allTabs[i]
	a.humanRowFocus = false
	a.clampCursors()
}

func (a *App) cyclePane() {
	switch a.focus {
	case paneSidebar:
		a.focus = paneMain
	case paneMain:
		// Skip the inspector when it isn't on screen (narrow / human mode),
		// otherwise focus would land on a pane that isn't rendered.
		if a.inspectorVisible() {
			a.focus = paneInspector
		} else {
			a.focus = paneSidebar
		}
	default:
		a.focus = paneSidebar
	}
}

// normalizeFocus pulls focus off the inspector whenever it isn't visible — the
// guard for resize / human-mode toggles that hide the pane out from under it.
func (a *App) normalizeFocus() {
	if a.focus == paneInspector && !a.inspectorVisible() {
		a.focus = paneMain
	}
}

func (a *App) moveSidebar(delta int) {
	a.sidebarIndex = clamp(a.sidebarIndex+delta, len(a.sidebarItems()))
}

func (a *App) moveMain(delta int) {
	a.setMainCursor(clamp(a.mainCursor()+delta, a.mainRowCount()))
}

func (a *App) handleSidebarKey(s string) tea.Cmd {
	item := a.currentSidebarItem()
	switch s {
	case "up", "k":
		a.moveSidebar(-1)
	case "down", "j":
		a.moveSidebar(1)
	case "enter":
		switch item.kind {
		case sbVault:
			a.activeVault = item.name
			a.clampCursors()
		case sbConsumer:
			if a.consumerFilter == item.name {
				a.consumerFilter = ""
			} else {
				a.consumerFilter = item.name
			}
			a.setMainCursor(0)
		}
	case "a":
		if item.kind == sbVault {
			return a.addVaultFlow()
		}
		return a.addConsumerFlow()
	case "e":
		switch item.kind {
		case sbVault:
			return a.editVaultFlow(item.name)
		case sbConsumer:
			return a.editConsumerFlow(item.name)
		}
	case "x":
		switch item.kind {
		case sbVault:
			return a.removeVaultFlow(item.name)
		case sbConsumer:
			return a.removeConsumerFlow(item.name)
		}
	case "u":
		if item.kind == sbVault {
			return a.ensureUnlocked(item.name, func(a *App) tea.Cmd { return nil })
		}
	case "D":
		if item.kind == sbVault {
			return a.setDefaultVault(item.name)
		}
	}
	return nil
}

func (a *App) handleMainKey(s string) tea.Cmd {
	switch a.tab {
	case tabVariables:
		return a.handleVariablesKey(s)
	case tabGlobals:
		return a.handleGlobalsKey(s)
	case tabGroups:
		return a.handleGroupsKey(s)
	case tabCompose:
		return a.handleComposeKey(s)
	case tabBackups:
		return a.handleBackupsKey(s)
	}
	return nil
}

func (a *App) handleVariablesKey(s string) tea.Cmd {
	sel := a.selectedVariable()
	// card row focus mode
	if a.humanMode && a.humanRowFocus {
		switch s {
		case "up", "k":
			a.humanRowIndex = clamp(a.humanRowIndex-1, len(a.variableCard(sel)))
			return nil
		case "down", "j":
			a.humanRowIndex = clamp(a.humanRowIndex+1, len(a.variableCard(sel)))
			return nil
		case "esc":
			a.humanRowFocus = false
			return nil
		case "enter":
			if c := a.currentCardConsumer(); c != "" {
				return a.valueEditFlow(sel, c)
			}
			return nil
		}
	}

	switch s {
	case "up", "k":
		a.moveMain(-1)
		return nil
	case "down", "j":
		a.moveMain(1)
		return nil
	case "enter":
		if sel == "" {
			return nil
		}
		if a.humanMode {
			a.humanRowFocus = true
			a.humanRowIndex = 0
			return nil
		}
		// When the inspector pane is off screen (narrow terminal), show its
		// detail in a modal instead of focusing a pane that isn't rendered.
		if !a.inspectorVisible() {
			return a.pushModal(newDetailModal(a))
		}
		a.focus = paneInspector
		a.inspectorIndex = 0
		return nil
	}
	if sel == "" {
		return nil
	}
	preset := ""
	if a.humanMode && a.humanRowFocus {
		preset = a.currentCardConsumer()
	}
	switch s {
	case "n":
		return a.defineVarFlow()
	case "e":
		return a.editVarFlow(sel)
	case "x":
		return a.removeVarFlow(sel)
	case "w":
		return a.wireFlow(sel)
	case "u":
		return a.unwireFlow(sel, nil)
	case "s":
		return a.setValueFlow(sel, preset)
	case "r":
		return a.revealValueFlow(sel, preset)
	case "d":
		return a.toggleDisabledFlow(sel, preset)
	}
	return nil
}

// currentCardConsumer returns the first consumer of the focused card row.
func (a *App) currentCardConsumer() string {
	rows := a.variableCard(a.selectedVariable())
	if a.humanRowIndex >= 0 && a.humanRowIndex < len(rows) && len(rows[a.humanRowIndex].consumers) > 0 {
		return rows[a.humanRowIndex].consumers[0]
	}
	return ""
}

func (a *App) handleGlobalsKey(s string) tea.Cmd {
	names := a.globalNames()
	sel := ""
	if i := a.mainCursor(); i >= 0 && i < len(names) {
		sel = names[i]
	}
	switch s {
	case "up", "k":
		a.moveMain(-1)
	case "down", "j":
		a.moveMain(1)
	case "n":
		return a.defineGlobalFlow()
	case "e":
		if sel != "" {
			return a.editGlobalFlow(sel)
		}
	case "x":
		if sel != "" {
			return a.removeGlobalFlow(sel)
		}
	}
	return nil
}

func (a *App) handleGroupsKey(s string) tea.Cmd {
	keys := a.groupKeysFiltered()
	sel := ""
	if i := a.mainCursor(); i >= 0 && i < len(keys) {
		sel = keys[i]
	}
	switch s {
	case "up", "k":
		a.moveMain(-1)
	case "down", "j":
		a.moveMain(1)
	case "n":
		return a.addGroupFlow()
	case "e":
		if sel != "" {
			return a.editGroupFlow(sel)
		}
	case "x":
		if sel != "" {
			return a.removeGroupFlow(sel)
		}
	}
	return nil
}

func (a *App) handleComposeKey(s string) tea.Cmd {
	files := a.composeFiles()
	sel := ""
	if i := a.mainCursor(); i >= 0 && i < len(files) {
		sel = files[i]
	}
	switch s {
	case "up", "k":
		a.moveMain(-1)
	case "down", "j":
		a.moveMain(1)
	case "n":
		return a.bindComposeFlow()
	case "x":
		if sel != "" {
			return a.unbindComposeFlow(sel)
		}
	}
	return nil
}

func (a *App) handleBackupsKey(s string) tea.Cmd {
	keys := a.backupsNewestFirst()
	sel := ""
	if i := a.mainCursor(); i >= 0 && i < len(keys) {
		sel = keys[i]
	}
	switch s {
	case "up", "k":
		a.moveMain(-1)
	case "down", "j":
		a.moveMain(1)
	case "n":
		a.busy = "backing up"
		return tea.Batch(a.createBackupCmd(), a.spinner.Tick)
	case "enter":
		if sel != "" {
			key := sel
			return a.pushModal(&confirmModal{
				title:  "Restore backup?",
				body:   "Overwrite current files with backup " + key + ".",
				danger: true,
				onYes: func(a *App) tea.Cmd {
					a.busy = "restoring"
					return tea.Batch(a.restoreBackupCmd(key), a.spinner.Tick)
				},
			})
		}
	}
	return nil
}

func (a *App) handleInspectorKey(s string) tea.Cmd {
	if a.tab != tabVariables {
		if s == "esc" {
			a.focus = paneMain
		}
		return nil
	}
	sel := a.selectedVariable()
	rows := a.variableWiring(sel)
	switch s {
	case "esc":
		a.focus = paneMain
		return nil
	case "up", "k":
		a.inspectorIndex = clamp(a.inspectorIndex-1, len(rows))
		return nil
	case "down", "j":
		a.inspectorIndex = clamp(a.inspectorIndex+1, len(rows))
		return nil
	}
	if a.inspectorIndex < 0 || a.inspectorIndex >= len(rows) {
		if s == "w" {
			return a.wireFlow(sel)
		}
		return nil
	}
	row := rows[a.inspectorIndex]
	switch s {
	case "s":
		a.activeVault = row.vault
		return a.setValueFlow(sel, row.consumer)
	case "r":
		a.activeVault = row.vault
		return a.revealValueFlow(sel, row.consumer)
	case "d":
		a.activeVault = row.vault
		return a.toggleDisabledFlow(sel, row.consumer)
	case "u":
		a.activeVault = row.vault
		return a.unwireFlow(sel, []string{row.consumer})
	case "w":
		return a.wireFlow(sel)
	}
	return nil
}
