package tui

import "charm.land/lipgloss/v2"

// Semantic color tokens. ANSI palette codes are used so the UI stays coherent
// with the user's terminal theme and degrades cleanly under NO_COLOR (the
// bubbletea v2 renderer applies the detected color profile).
var (
	colAccent  = lipgloss.Color("12") // focus, titles, primary
	colMuted   = lipgloss.Color("8")  // metadata, disabled, hints
	colGreen   = lipgloss.Color("10") // has-value, success, online
	colRed     = lipgloss.Color("9")  // error, danger, disabled
	colYellow  = lipgloss.Color("11") // warning, secret, pending
	colMagenta = lipgloss.Color("13") // shared key, special
	colCyan    = lipgloss.Color("14") // info, paths
	colFg      = lipgloss.Color("15") // bright foreground
)

// Glyphs. Each pairs with a letter or position so color is never the only
// signal (NO_COLOR / CVD safe).
const (
	glyphUnwired    = "·" // not wired in this vault
	glyphDisabled   = "#" // wired but disabled
	glyphNoValue    = "◌" // wired, no value set
	glyphHasValue   = "●" // wired, value present
	glyphShared     = "◆" // wired, key shared with another consumer
	glyphLocked     = "⚿" // vault locked — state unknown / lock badge
	glyphSecret     = "S" // variable is secret
	glyphEmptyVal   = "∅" // no value stored
	glyphMaskedVal  = "***"
	glyphDefault    = "★" // default vault
	glyphActive     = "✓" // active consumer filter
	glyphActiveItem = "●" // sidebar: the active vault / consumer (marker column)
	bullet          = "•"
)

// styles bundles the reusable lipgloss styles. Built once and held on the App.
type styles struct {
	title       lipgloss.Style
	subtle      lipgloss.Style
	muted       lipgloss.Style
	section     lipgloss.Style
	selected    lipgloss.Style
	selectedDim lipgloss.Style
	paneFocus   lipgloss.Style
	paneBlur    lipgloss.Style
	secret      lipgloss.Style
	hasValue    lipgloss.Style
	noValue     lipgloss.Style
	shared      lipgloss.Style
	disabled    lipgloss.Style
	statusOK    lipgloss.Style
	statusErr   lipgloss.Style
	statusBusy  lipgloss.Style
	modal       lipgloss.Style
	modalDanger lipgloss.Style
	modalTitle  lipgloss.Style
	keyCap      lipgloss.Style
	keyDesc     lipgloss.Style
	badge       lipgloss.Style
	blocker     lipgloss.Style
	warning     lipgloss.Style
}

func newStyles() styles {
	return styles{
		title:       lipgloss.NewStyle().Bold(true).Foreground(colAccent),
		subtle:      lipgloss.NewStyle().Foreground(colFg),
		muted:       lipgloss.NewStyle().Foreground(colMuted),
		section:     lipgloss.NewStyle().Bold(true).Foreground(colMuted),
		selected:    lipgloss.NewStyle().Bold(true).Foreground(colAccent).Reverse(true),
		selectedDim: lipgloss.NewStyle().Reverse(true),
		paneFocus: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colAccent).
			Padding(0, 1),
		paneBlur: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colMuted).
			Padding(0, 1),
		secret:     lipgloss.NewStyle().Foreground(colYellow),
		hasValue:   lipgloss.NewStyle().Foreground(colGreen),
		noValue:    lipgloss.NewStyle().Foreground(colMuted),
		shared:     lipgloss.NewStyle().Foreground(colMagenta),
		disabled:   lipgloss.NewStyle().Foreground(colRed),
		statusOK:   lipgloss.NewStyle().Foreground(colGreen),
		statusErr:  lipgloss.NewStyle().Foreground(colRed),
		statusBusy: lipgloss.NewStyle().Foreground(colCyan),
		modal: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colAccent).
			Padding(1, 2),
		modalDanger: lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(colRed).
			Padding(1, 2),
		modalTitle: lipgloss.NewStyle().Bold(true).Foreground(colAccent),
		keyCap:     lipgloss.NewStyle().Bold(true).Foreground(colAccent),
		keyDesc:    lipgloss.NewStyle().Foreground(colMuted),
		badge:      lipgloss.NewStyle().Foreground(colYellow),
		blocker:    lipgloss.NewStyle().Foreground(colRed),
		warning:    lipgloss.NewStyle().Foreground(colYellow),
	}
}
