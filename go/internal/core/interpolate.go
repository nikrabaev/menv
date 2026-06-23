package core

import (
	"fmt"
	"regexp"
	"strings"
)

// ${NAME} interpolation. Hybrid model: variable refs and static globals expand
// at generate time; runtime globals are emitted literally for the platform to
// resolve. "$${" escapes to "${".

// Segment is a token in a raw value string.
type Segment struct {
	Kind string // "text" | "ref"
	Text string // Kind=="text": literal text; Kind=="ref": referenced name
}

// GlobalResolution describes how a global name resolves in a given vault scope.
type GlobalResolution struct {
	Kind  string // "static" | "runtime"
	Value string // only set when Kind=="static"
}

var refNameRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// Tokenize parses a raw value string into literal text and ${NAME} reference
// segments. Malformed or unterminated references are kept as literal text.
func Tokenize(raw string) []Segment {
	var out []Segment
	var textBuf strings.Builder
	i := 0
	for i < len(raw) {
		if strings.HasPrefix(raw[i:], "$${") {
			textBuf.WriteString("${")
			i += 3
			continue
		}
		if strings.HasPrefix(raw[i:], "${") {
			end := strings.Index(raw[i+2:], "}")
			if end != -1 {
				name := raw[i+2 : i+2+end]
				if refNameRE.MatchString(name) {
					if textBuf.Len() > 0 {
						out = append(out, Segment{Kind: "text", Text: textBuf.String()})
						textBuf.Reset()
					}
					out = append(out, Segment{Kind: "ref", Text: name})
					i = i + 2 + end + 1
					continue
				}
			}
		}
		textBuf.WriteByte(raw[i])
		i++
	}
	if textBuf.Len() > 0 {
		out = append(out, Segment{Kind: "text", Text: textBuf.String()})
	}
	return out
}

// ExtractRefs returns all ${NAME} reference names found in raw.
func ExtractRefs(raw string) []string {
	var names []string
	for _, seg := range Tokenize(raw) {
		if seg.Kind == "ref" {
			names = append(names, seg.Text)
		}
	}
	return names
}

// ExpandInput provides the scope for expanding a set of values.
type ExpandInput struct {
	// Variable name → raw value, for ONE (vault, consumer) scope.
	Values map[string]string
	// Global name → how it resolves in this vault.
	Globals map[string]GlobalResolution
}

// ExpandAll expands every value in input.Values, substituting ${NAME}
// references recursively. Throws VALIDATION on unresolvable refs or cycles.
func ExpandAll(input ExpandInput) (map[string]string, error) {
	done := make(map[string]string, len(input.Values))
	var visiting []string

	var resolve func(name string) (string, error)
	resolve = func(name string) (string, error) {
		if v, ok := done[name]; ok {
			return v, nil
		}
		for i, v := range visiting {
			if v == name {
				chain := append(visiting[i:], name)
				return "", &MenvError{
					Code:    ErrValidation,
					Message: "interpolation cycle: " + strings.Join(chain, " → "),
				}
			}
		}
		raw := input.Values[name]
		visiting = append(visiting, name)
		var result strings.Builder
		for _, seg := range Tokenize(raw) {
			if seg.Kind == "text" {
				result.WriteString(seg.Text)
				continue
			}
			if _, isVar := input.Values[seg.Text]; isVar {
				expanded, err := resolve(seg.Text)
				if err != nil {
					return "", err
				}
				result.WriteString(expanded)
				continue
			}
			g, isGlobal := input.Globals[seg.Text]
			if !isGlobal {
				return "", &MenvError{
					Code: ErrValidation,
					Message: fmt.Sprintf(
						"${%s} in %s does not resolve to a variable or global in this scope",
						seg.Text, name,
					),
				}
			}
			if g.Kind == "static" {
				result.WriteString(g.Value)
			} else {
				result.WriteString("${" + seg.Text + "}")
			}
		}
		visiting = visiting[:len(visiting)-1]
		expanded := result.String()
		done[name] = expanded
		return expanded, nil
	}

	for name := range input.Values {
		if _, err := resolve(name); err != nil {
			return nil, err
		}
	}
	return done, nil
}
