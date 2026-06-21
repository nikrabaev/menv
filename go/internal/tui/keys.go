package tui

import "fmt"

// KeyHint is one entry in the footer hint bar.
type KeyHint struct {
	Key  string
	Desc string
}

// FooterHints returns the key hints appropriate for the current state.
func FooterHints(s *AppState) []KeyHint {
	if s.FilterEditing {
		return []KeyHint{
			{Key: "enter/esc", Desc: "done"},
		}
	}
	if top := s.topModal(); top != nil {
		switch top.(type) {
		case PlanModal:
			return []KeyHint{
				{Key: "enter", Desc: "apply"},
				{Key: "f", Desc: "force"},
				{Key: "esc", Desc: "cancel"},
			}
		case ConfirmModal:
			return []KeyHint{
				{Key: "enter", Desc: "confirm"},
				{Key: "esc", Desc: "cancel"},
			}
		case UnlockModal:
			return []KeyHint{
				{Key: "enter", Desc: "unlock"},
				{Key: "esc", Desc: "cancel"},
			}
		case FormModal:
			return []KeyHint{
				{Key: "tab", Desc: "next field"},
				{Key: "enter", Desc: "submit"},
				{Key: "esc", Desc: "cancel"},
			}
		case RevealModal:
			return []KeyHint{
				{Key: "esc", Desc: "close"},
			}
		case FindingsModal:
			return []KeyHint{
				{Key: "j/k", Desc: "scroll"},
				{Key: "esc", Desc: "close"},
			}
		case GenerateModal:
			return []KeyHint{
				{Key: "enter", Desc: "apply"},
				{Key: "esc", Desc: "cancel"},
			}
		case HelpModal:
			return []KeyHint{{Key: "esc", Desc: "close"}}
		case QuitModal:
			return []KeyHint{
				{Key: "enter", Desc: "quit"},
				{Key: "esc", Desc: "cancel"},
			}
		case ConsumerPickModal:
			return []KeyHint{
				{Key: "j/k", Desc: "pick"},
				{Key: "enter", Desc: "select"},
				{Key: "esc", Desc: "cancel"},
			}
		case OrphanPromptModal:
			return []KeyHint{
				{Key: "d", Desc: "delete"},
				{Key: "k", Desc: "keep"},
				{Key: "esc", Desc: "cancel"},
			}
		}
	}

	// Pane-specific hints.
	base := []KeyHint{
		{Key: "tab", Desc: "pane"},
		{Key: "[/]", Desc: "tab"},
		{Key: "?", Desc: "help"},
		{Key: "q", Desc: "quit"},
	}

	switch s.Focus {
	case PaneSidebar:
		return append([]KeyHint{
			{Key: "j/k", Desc: "move"},
			{Key: "a", Desc: "add"},
			{Key: "e", Desc: "edit"},
			{Key: "x", Desc: "remove"},
			{Key: "u", Desc: "unlock"},
		}, base...)
	case PaneMain:
		switch s.Tab {
		case TabVariables:
			return append([]KeyHint{
				{Key: "j/k", Desc: "move"},
				{Key: "/", Desc: "filter"},
				{Key: "n", Desc: "new"},
				{Key: "s", Desc: "set"},
				{Key: "w", Desc: "wire"},
				{Key: "e", Desc: "edit"},
				{Key: "x", Desc: "remove"},
				{Key: "g", Desc: "generate"},
			}, base...)
		case TabGlobals:
			return append([]KeyHint{
				{Key: "j/k", Desc: "move"},
				{Key: "n", Desc: "new"},
				{Key: "e", Desc: "edit"},
				{Key: "x", Desc: "remove"},
			}, base...)
		case TabGroups:
			return append([]KeyHint{
				{Key: "j/k", Desc: "move"},
				{Key: "n", Desc: "new"},
				{Key: "e", Desc: "edit"},
				{Key: "x", Desc: "remove"},
			}, base...)
		case TabCompose:
			return append([]KeyHint{
				{Key: "j/k", Desc: "move"},
				{Key: "n", Desc: "bind"},
				{Key: "x", Desc: "unbind"},
			}, base...)
		case TabBackups:
			return append([]KeyHint{
				{Key: "j/k", Desc: "move"},
				{Key: "n", Desc: "backup"},
				{Key: "enter", Desc: "restore"},
			}, base...)
		}
	case PaneInspector:
		return append([]KeyHint{
			{Key: "j/k", Desc: "row"},
			{Key: "s", Desc: "set"},
			{Key: "d", Desc: "disable"},
			{Key: "u", Desc: "unwire"},
			{Key: "esc", Desc: "back"},
		}, base...)
	}
	return base
}

// FormatHints renders hints as "key desc · key desc …" for the footer.
func FormatHints(hints []KeyHint) string {
	out := ""
	for i, h := range hints {
		if i > 0 {
			out += "  "
		}
		out += fmt.Sprintf("%s %s",
			styleKeyName.Render(h.Key),
			styleKeyHint.Render(h.Desc),
		)
	}
	return out
}
