package generate

import (
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/registry"
)

var (
	openRE  = regexp.MustCompile(`^(\s*)#\s*<menv:([a-z0-9][a-z0-9._-]*)>\s*$`)
	closeRE = regexp.MustCompile(`^\s*#\s*</menv>\s*$`)
)

// MarkerRegion describes one pair of menv compose markers within a file.
type MarkerRegion struct {
	Consumer string
	Start    int    // index of the opening `# <menv:consumer>` line
	End      int    // index of the closing `# </menv>` line
	Indent   string // leading whitespace of the opening marker
}

// FindMarkerRegions parses compose markers from file content.
func FindMarkerRegions(content string) (regions []MarkerRegion, errors []string) {
	lines := strings.Split(content, "\n")
	type openState struct {
		consumer string
		start    int
		indent   string
	}
	var open *openState
	for i, line := range lines {
		if m := openRE.FindStringSubmatch(line); m != nil {
			if open != nil {
				errors = append(errors, fmt.Sprintf("nested menv marker at line %d", i+1))
			}
			open = &openState{consumer: m[2], start: i, indent: m[1]}
			continue
		}
		if closeRE.MatchString(line) {
			if open == nil {
				errors = append(errors, fmt.Sprintf("unmatched </menv> at line %d", i+1))
				continue
			}
			regions = append(regions, MarkerRegion{
				Consumer: open.consumer,
				Start:    open.start,
				End:      i,
				Indent:   open.indent,
			})
			open = nil
		}
	}
	if open != nil {
		errors = append(errors, fmt.Sprintf("unclosed <menv:%s> marker", open.consumer))
	}
	return regions, errors
}

// SpliceRegions replaces the body between each marker pair with the supplied
// fill lines; marker lines themselves and all other content are preserved.
func SpliceRegions(content string, regions []MarkerRegion, fillByStart map[int][]string) string {
	lines := strings.Split(content, "\n")
	byStart := make(map[int]MarkerRegion, len(regions))
	for _, r := range regions {
		byStart[r.Start] = r
	}
	var out []string
	i := 0
	for i < len(lines) {
		if r, ok := byStart[i]; ok {
			out = append(out, lines[i]) // opening marker
			out = append(out, fillByStart[r.Start]...)
			out = append(out, lines[r.End]) // closing marker
			i = r.End + 1
			continue
		}
		out = append(out, lines[i])
		i++
	}
	return strings.Join(out, "\n")
}

// ComposeKey returns the interpolation key for a (consumer, variable) pair.
func ComposeKey(consumer, name string) string {
	upper := strings.ToUpper(consumer)
	var b strings.Builder
	for _, ch := range upper {
		if (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') {
			b.WriteRune(ch)
		} else {
			b.WriteRune('_')
		}
	}
	b.WriteRune('_')
	b.WriteString(name)
	return b.String()
}

// ComposePreview is the result of one compose generation pass.
type ComposePreview struct {
	Writes   []FileWrite
	Errors   []core.PlanIssue
	Warnings []core.PlanIssue
}

type composeValue struct {
	key      string
	value    string
	disabled bool
}

// PreviewCompose processes all registered compose files, filling marker regions
// and computing .env.compose content for each directory.
func PreviewCompose(
	root string,
	reg registry.Registry,
	opts GenerateOpts,
	sessions map[string]core.VaultSession,
) (ComposePreview, error) {
	vaultName := coalesce(opts.Vault, reg.Defaults.Vault)
	preview := ComposePreview{}
	sess := sessions[vaultName]
	globals := GlobalsFor(reg, vaultName)

	type dirEntry struct {
		values map[string]composeValue
	}
	valuesByDir := map[string]*dirEntry{}
	succeededDirs := map[string]bool{}
	var splicedWrites []FileWrite

	for _, file := range reg.Compose.Files {
		data, err := readFile(filepath.Join(root, file))
		if err != nil {
			preview.Errors = append(preview.Errors, core.PlanIssue{
				Code:    "MISSING_COMPOSE_FILE",
				Message: fmt.Sprintf("registered compose file not found: %s", file),
			})
			continue
		}
		content := string(data)
		regions, errs := FindMarkerRegions(content)
		for _, e := range errs {
			preview.Errors = append(preview.Errors, core.PlanIssue{Code: "COMPOSE_MARKER", Message: file + ": " + e})
		}
		if len(errs) > 0 {
			continue
		}
		if len(regions) == 0 {
			preview.Warnings = append(preview.Warnings, core.PlanIssue{
				Code:    "COMPOSE_NO_MARKERS",
				Message: file + ": bound but has no menv markers",
			})
		}
		dir := filepath.Dir(file)
		if dir == "." {
			dir = ""
		}
		if _, ok := valuesByDir[dir]; !ok {
			valuesByDir[dir] = &dirEntry{values: map[string]composeValue{}}
		}
		de := valuesByDir[dir]
		fillByStart := map[int][]string{}
		fileFailed := false

		for _, region := range regions {
			if _, ok := reg.Consumers[region.Consumer]; !ok {
				preview.Errors = append(preview.Errors, core.PlanIssue{
					Code:    "COMPOSE_UNKNOWN_CONSUMER",
					Message: fmt.Sprintf("%s: marker names unknown consumer %q", file, region.Consumer),
				})
				fileFailed = true
				continue
			}
			if sess == nil {
				preview.Warnings = append(preview.Warnings, core.PlanIssue{
					Code:    "UNVERIFIED_VAULT",
					Message: fmt.Sprintf("vault %q could not be opened for compose", vaultName),
				})
				fileFailed = true
				continue
			}

			rawVals := map[string]string{}
			type varMeta struct {
				name     string
				disabled bool
			}
			var varMetas []varMeta
			// Collect wired variable names in sorted order.
			varNames := make([]string, 0)
			for name, def := range reg.Variables {
				if _, ok := def.VaultMapping[vaultName][region.Consumer]; ok {
					varNames = append(varNames, name)
				}
			}
			sort.Strings(varNames)
			for _, name := range varNames {
				entry := reg.Variables[name].VaultMapping[vaultName][region.Consumer]
				val, _, err := sess.Get(entry.Key)
				if err != nil {
					return ComposePreview{}, err
				}
				rawVals[name] = val
				varMetas = append(varMetas, varMeta{name: name, disabled: entry.Disabled})
			}
			expanded, err := core.ExpandAll(core.ExpandInput{Values: rawVals, Globals: globals})
			if err != nil {
				return ComposePreview{}, err
			}
			var fill []string
			for _, vm := range varMetas {
				key := ComposeKey(region.Consumer, vm.name)
				fill = append(fill, fmt.Sprintf("%s- %s=${%s}", region.Indent, vm.name, key))
				de.values[key] = composeValue{key: key, value: expanded[vm.name], disabled: vm.disabled}
			}
			fillByStart[region.Start] = fill
		}
		if fileFailed {
			continue
		}
		succeededDirs[dir] = true
		splicedWrites = append(splicedWrites, FileWrite{Path: file, Content: SpliceRegions(content, regions, fillByStart)})
	}

	if len(preview.Errors) > 0 {
		return ComposePreview{Errors: preview.Errors, Warnings: preview.Warnings}, nil
	}
	preview.Writes = append(preview.Writes, splicedWrites...)

	for dir, de := range valuesByDir {
		if !succeededDirs[dir] {
			continue
		}
		header := DisclaimerHeader(HeaderMeta{Vault: vaultName})
		keys := make([]string, 0, len(de.values))
		for k := range de.values {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var lines []string
		for _, k := range keys {
			cv := de.values[k]
			if cv.disabled {
				lines = append(lines, "# "+k+"="+cv.value)
			} else {
				lines = append(lines, k+"="+cv.value)
			}
		}
		composePath := filepath.Join(dir, ".env.compose")
		if dir == "" {
			composePath = ".env.compose"
		}
		content := header + strings.Join(lines, "\n") + "\n"
		preview.Writes = append(preview.Writes, FileWrite{Path: composePath, Content: content})
	}
	return preview, nil
}
