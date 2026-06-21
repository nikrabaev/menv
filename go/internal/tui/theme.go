package tui

import "github.com/charmbracelet/lipgloss"

var (
	colorAccent  = lipgloss.Color("#7C6AF7")
	colorMuted   = lipgloss.Color("#6B7280")
	colorSuccess = lipgloss.Color("#10B981")
	colorWarn    = lipgloss.Color("#F59E0B")
	colorErr     = lipgloss.Color("#EF4444")
	colorFg      = lipgloss.Color("#F9FAFB")
	colorDim     = lipgloss.Color("#374151")
	colorBorder  = lipgloss.Color("#4B5563")
	colorSecret  = lipgloss.Color("#818CF8")
	colorHeader  = lipgloss.Color("#9CA3AF")

	styleTitle = lipgloss.NewStyle().
			Bold(true).
			Foreground(colorAccent)

	styleSelected = lipgloss.NewStyle().
			Background(colorAccent).
			Foreground(colorFg).
			Bold(true)

	styleMuted = lipgloss.NewStyle().
			Foreground(colorMuted)

	styleSuccess = lipgloss.NewStyle().
			Foreground(colorSuccess)

	styleWarn = lipgloss.NewStyle().
			Foreground(colorWarn)

	styleErr = lipgloss.NewStyle().
			Foreground(colorErr)

	styleHeader = lipgloss.NewStyle().
			Foreground(colorHeader).
			Bold(true)

	styleSecret = lipgloss.NewStyle().
			Foreground(colorSecret)

	styleBorder = lipgloss.NewStyle().
			BorderStyle(lipgloss.RoundedBorder()).
			BorderForeground(colorBorder)

	styleBorderActive = lipgloss.NewStyle().
				BorderStyle(lipgloss.RoundedBorder()).
				BorderForeground(colorAccent)

	stylePaneTitle = lipgloss.NewStyle().
			Foreground(colorAccent).
			Bold(true).
			MarginBottom(0)

	styleKeyHint = lipgloss.NewStyle().
			Foreground(colorMuted)

	styleKeyName = lipgloss.NewStyle().
			Foreground(colorAccent).
			Bold(true)

	styleStatus = lipgloss.NewStyle().
			Foreground(colorSuccess)

	styleStatusErr = lipgloss.NewStyle().
			Foreground(colorErr)

	styleModalTitle = lipgloss.NewStyle().
			Bold(true).
			Foreground(colorAccent).
			MarginBottom(1)

	styleDanger = lipgloss.NewStyle().
			Foreground(colorErr).
			Bold(true)
)
