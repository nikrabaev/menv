package tui

import (
	"sort"
	"strings"

	"charm.land/lipgloss/v2"
)

func sortedStrings(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func keysOf[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// smartCaseContains does a case-insensitive match unless the needle has an
// uppercase letter, in which case it is case-sensitive (ripgrep "smart case").
func smartCaseContains(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	if needle == strings.ToLower(needle) {
		return strings.Contains(strings.ToLower(haystack), needle)
	}
	return strings.Contains(haystack, needle)
}

// ── sidebar ─────────────────────────────────────────────────────────────────

type sidebarKind int

const (
	sbHeader sidebarKind = iota
	sbVault
	sbConsumer
	sbPlaceholder
)

type sidebarItem struct {
	kind sidebarKind
	name string // entity name (for vault/consumer)
	text string // rendered label
}

func (a *App) sidebarItems() []sidebarItem {
	var items []sidebarItem
	items = append(items, sidebarItem{kind: sbHeader, text: "VAULTS"})
	for _, name := range keysOf(a.reg.Vaults) {
		label := name
		if !a.vaultUnlocked(name) {
			label += " " + glyphLockBadge
		}
		if a.reg.Defaults.Vault == name {
			label += " " + glyphDefault
		}
		items = append(items, sidebarItem{kind: sbVault, name: name, text: label})
	}
	items = append(items, sidebarItem{kind: sbHeader, text: "CONSUMERS"})
	consumers := keysOf(a.reg.Consumers)
	if len(consumers) == 0 {
		items = append(items, sidebarItem{kind: sbPlaceholder, text: "(none — press a)"})
	}
	for _, name := range consumers {
		label := name
		if a.consumerFilter == name {
			label += " " + glyphActive
		}
		items = append(items, sidebarItem{kind: sbConsumer, name: name, text: label})
	}
	return items
}

func (a *App) currentSidebarItem() sidebarItem {
	items := a.sidebarItems()
	if a.sidebarIndex >= 0 && a.sidebarIndex < len(items) {
		return items[a.sidebarIndex]
	}
	return sidebarItem{}
}

// ── variables ───────────────────────────────────────────────────────────────

// activeVaultConsumers returns the consumers wired in the active vault across
// all variables, sorted — these are the matrix columns.
func (a *App) activeVaultConsumers() []string {
	set := map[string]bool{}
	for _, def := range a.reg.Variables {
		for c := range def.VaultMapping[a.activeVault] {
			set[c] = true
		}
	}
	return sortedStrings(set)
}

// variableMatches applies the active text filter and consumer filter.
func (a *App) variableMatches(name string) bool {
	if !smartCaseContains(name, a.filter()) {
		return false
	}
	if a.consumerFilter != "" {
		def := a.reg.Variables[name]
		if _, ok := def.VaultMapping[a.activeVault][a.consumerFilter]; !ok {
			return false
		}
	}
	return true
}

type varGroup struct {
	title string
	vars  []string
}

// groupedVariables returns the filtered variables grouped by group (ungrouped
// last), each group's members sorted alphabetically.
func (a *App) groupedVariables() []varGroup {
	byGroup := map[string][]string{}
	var ungrouped []string
	for _, name := range keysOf(a.reg.Variables) {
		if !a.variableMatches(name) {
			continue
		}
		gk := a.reg.Variables[name].GroupKey
		if gk == "" {
			ungrouped = append(ungrouped, name)
		} else {
			byGroup[gk] = append(byGroup[gk], name)
		}
	}
	var groups []varGroup
	for _, gk := range keysOf(a.reg.Groups) {
		members := byGroup[gk]
		if len(members) == 0 {
			continue
		}
		sort.Strings(members)
		title := a.reg.Groups[gk].Title
		if title == "" {
			title = gk
		}
		groups = append(groups, varGroup{title: title, vars: members})
	}
	if len(ungrouped) > 0 {
		sort.Strings(ungrouped)
		groups = append(groups, varGroup{title: "(ungrouped)", vars: ungrouped})
	}
	return groups
}

// flatVariables flattens groupedVariables into the cursor-addressable order.
func (a *App) flatVariables() []string {
	var out []string
	for _, g := range a.groupedVariables() {
		out = append(out, g.vars...)
	}
	return out
}

// selectedVariable returns the variable under the variables-tab cursor, or "".
func (a *App) selectedVariable() string {
	vars := a.flatVariables()
	i := a.mainCursor()
	if i >= 0 && i < len(vars) {
		return vars[i]
	}
	return ""
}

// cellGlyph computes the matrix glyph + style for (variable, consumer) in the
// active vault. Precedence: locked > unwired > disabled > shared > value.
func (a *App) cellGlyph(name, consumer string) (string, lipgloss.Style) {
	def := a.reg.Variables[name]
	if !a.vaultUnlocked(a.activeVault) {
		return glyphLocked, a.style.muted
	}
	mapping := def.VaultMapping[a.activeVault]
	entry, ok := mapping[consumer]
	if !ok {
		return glyphUnwired, a.style.muted
	}
	if entry.Disabled {
		return glyphDisabled, a.style.disabled
	}
	shared := false
	for c, e := range mapping {
		if c != consumer && e.Key == entry.Key {
			shared = true
			break
		}
	}
	if shared {
		return glyphShared, a.style.shared
	}
	if v := a.vaultValues(a.activeVault)[entry.Key]; v != "" {
		return glyphHasValue, a.style.hasValue
	}
	return glyphNoValue, a.style.noValue
}

// ── human cards ─────────────────────────────────────────────────────────────

type cardRow struct {
	consumers []string // consumers sharing this value/key
	key       string
	hasValue  bool
	value     string
	disabled  bool
}

// variableCard builds the grouped rows for one variable in the active vault:
// rows grouped by shared key, most-consumers-first, no-value group last.
func (a *App) variableCard(name string) []cardRow {
	def := a.reg.Variables[name]
	mapping := def.VaultMapping[a.activeVault]
	byKey := map[string][]string{}
	disabledByKey := map[string]bool{}
	for c, e := range mapping {
		byKey[e.Key] = append(byKey[e.Key], c)
		if e.Disabled {
			disabledByKey[e.Key] = true
		}
	}
	vals := a.vaultValues(a.activeVault)
	var rows []cardRow
	for key, cs := range byKey {
		sort.Strings(cs)
		v, has := "", false
		if vals != nil {
			v = vals[key]
			has = v != ""
		}
		rows = append(rows, cardRow{
			consumers: cs,
			key:       key,
			hasValue:  has,
			value:     v,
			disabled:  disabledByKey[key],
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		// no-value group last, then most consumers first, then by name.
		if rows[i].hasValue != rows[j].hasValue {
			return rows[i].hasValue
		}
		if len(rows[i].consumers) != len(rows[j].consumers) {
			return len(rows[i].consumers) > len(rows[j].consumers)
		}
		return strings.Join(rows[i].consumers, ",") < strings.Join(rows[j].consumers, ",")
	})
	return rows
}

// ── globals / groups / compose / backups ────────────────────────────────────

func (a *App) globalNames() []string {
	var out []string
	for _, n := range keysOf(a.reg.Globals) {
		if smartCaseContains(n, a.filter()) {
			out = append(out, n)
		}
	}
	return out
}

// globalSource renders the source of a global for the active vault.
func (a *App) globalSource(name string) string {
	def := a.reg.Globals[name]
	v, ok := def.Values[a.activeVault]
	if !ok {
		return "(not for this vault)"
	}
	if v.Source == "static" {
		return "static = " + v.Value
	}
	return "runtime"
}

func (a *App) groupKeysFiltered() []string {
	var out []string
	for _, k := range keysOf(a.reg.Groups) {
		if smartCaseContains(k, a.filter()) || smartCaseContains(a.reg.Groups[k].Title, a.filter()) {
			out = append(out, k)
		}
	}
	return out
}

func (a *App) groupMemberCount(key string) int {
	n := 0
	for _, def := range a.reg.Variables {
		if def.GroupKey == key {
			n++
		}
	}
	return n
}

func (a *App) composeFiles() []string {
	var out []string
	for _, f := range a.reg.Compose.Files {
		if smartCaseContains(f, a.filter()) {
			out = append(out, f)
		}
	}
	return out
}

// composeStatus returns a badge for a compose file derived from findings.
func (a *App) composeStatus(file string) string {
	for _, f := range a.findings {
		if strings.Contains(f.Message, file) && strings.HasPrefix(f.Code, "COMPOSE") || (strings.Contains(f.Message, file) && f.Code == "MISSING_COMPOSE_FILE") {
			sym := "⚠"
			if f.Severity == "error" {
				sym = "✖"
			}
			return sym + " " + f.Code
		}
	}
	return "bound"
}

// backupsNewestFirst returns backup keys newest first.
func (a *App) backupsNewestFirst() []string {
	out := append([]string{}, a.backups...)
	sort.Sort(sort.Reverse(sort.StringSlice(out)))
	return out
}

// ── inspector: variable wiring rows ─────────────────────────────────────────

type wiringRow struct {
	vault    string
	consumer string
	key      string
	disabled bool
	shared   bool
}

// variableWiring returns every (vault, consumer) wiring for a variable, sorted.
func (a *App) variableWiring(name string) []wiringRow {
	def := a.reg.Variables[name]
	var rows []wiringRow
	for _, vault := range keysOf(def.VaultMapping) {
		mapping := def.VaultMapping[vault]
		for _, consumer := range keysOf(mapping) {
			entry := mapping[consumer]
			shared := false
			for c, e := range mapping {
				if c != consumer && e.Key == entry.Key {
					shared = true
					break
				}
			}
			rows = append(rows, wiringRow{
				vault:    vault,
				consumer: consumer,
				key:      entry.Key,
				disabled: entry.Disabled,
				shared:   shared,
			})
		}
	}
	return rows
}

// ── cursor management ───────────────────────────────────────────────────────

func clamp(i, n int) int {
	if n <= 0 {
		return 0
	}
	if i < 0 {
		return 0
	}
	if i >= n {
		return n - 1
	}
	return i
}

// mainRowCount returns the number of cursor-addressable rows in the active tab.
func (a *App) mainRowCount() int {
	switch a.tab {
	case tabVariables:
		return len(a.flatVariables())
	case tabGlobals:
		return len(a.globalNames())
	case tabGroups:
		return len(a.groupKeysFiltered())
	case tabCompose:
		return len(a.composeFiles())
	case tabBackups:
		return len(a.backupsNewestFirst())
	}
	return 0
}

func (a *App) clampCursors() {
	a.sidebarIndex = clamp(a.sidebarIndex, len(a.sidebarItems()))
	a.setMainCursor(clamp(a.mainCursor(), a.mainRowCount()))
	if a.tab == tabVariables {
		if v := a.selectedVariable(); v != "" {
			a.inspectorIndex = clamp(a.inspectorIndex, len(a.variableWiring(v)))
			a.humanRowIndex = clamp(a.humanRowIndex, len(a.variableCard(v)))
		}
	}
}
