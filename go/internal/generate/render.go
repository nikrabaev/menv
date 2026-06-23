package generate

import (
	"sort"
	"strings"

	"github.com/nikrabaev/menv/go/internal/registry"
)

// RenderEntry is one variable ready for rendering into a .env file.
type RenderEntry struct {
	Name     string
	Value    string // already interpolation-expanded
	Disabled bool
	Secret   bool
	GroupKey string
	Example  string
}

type section struct {
	title   string // empty = ungrouped
	entries []RenderEntry
}

func sections(entries []RenderEntry, groups map[string]registry.GroupDef) []section {
	byName := func(a, b RenderEntry) bool { return a.Name < b.Name }
	var out []section
	// Groups in registry iteration order (map — sort for determinism).
	groupKeys := make([]string, 0, len(groups))
	for k := range groups {
		groupKeys = append(groupKeys, k)
	}
	sort.Strings(groupKeys)
	for _, key := range groupKeys {
		def := groups[key]
		var members []RenderEntry
		for _, e := range entries {
			if e.GroupKey == key {
				members = append(members, e)
			}
		}
		if len(members) == 0 {
			continue
		}
		sort.Slice(members, func(i, j int) bool { return byName(members[i], members[j]) })
		out = append(out, section{title: def.Title, entries: members})
	}
	var ungrouped []RenderEntry
	for _, e := range entries {
		if _, inGroup := groups[e.GroupKey]; !inGroup || e.GroupKey == "" {
			ungrouped = append(ungrouped, e)
		}
	}
	sort.Slice(ungrouped, func(i, j int) bool { return byName(ungrouped[i], ungrouped[j]) })
	if len(ungrouped) > 0 {
		out = append(out, section{title: "", entries: ungrouped})
	}
	return out
}

// RenderEnvContent produces the text of a .env file from the given entries.
func RenderEnvContent(entries []RenderEntry, groups map[string]registry.GroupDef, header string) string {
	sects := sections(entries, groups)
	var blocks []string
	for _, s := range sects {
		var lines []string
		if s.title != "" {
			lines = append(lines, "# ── "+s.title+" ──")
		}
		for _, e := range s.entries {
			if e.Disabled {
				lines = append(lines, "# "+e.Name+"="+e.Value)
			} else {
				lines = append(lines, e.Name+"="+e.Value)
			}
		}
		blocks = append(blocks, strings.Join(lines, "\n"))
	}
	if len(blocks) == 0 {
		return header
	}
	return header + strings.Join(blocks, "\n\n") + "\n"
}

// SplitSecrets partitions entries into main and local sets based on the
// secretsAsLocalOverrides flag.
func SplitSecrets(entries []RenderEntry, secretsAsLocalOverrides bool) (main, local []RenderEntry) {
	if !secretsAsLocalOverrides {
		return entries, nil
	}
	for _, e := range entries {
		if e.Secret {
			local = append(local, e)
		} else {
			main = append(main, e)
		}
	}
	return main, local
}

// RenderExampleContent produces a .env.example: all entries, values-free.
func RenderExampleContent(entries []RenderEntry, groups map[string]registry.GroupDef, header string) string {
	templated := make([]RenderEntry, len(entries))
	for i, e := range entries {
		t := e
		t.Value = e.Example
		t.Disabled = false
		templated[i] = t
	}
	return RenderEnvContent(templated, groups, header)
}
