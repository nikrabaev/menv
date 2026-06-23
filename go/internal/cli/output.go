package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/nikrabaev/menv/go/internal/core"
)

// OutputMode controls how results are emitted.
type OutputMode string

const (
	ModeJSON   OutputMode = "json"
	ModePretty OutputMode = "pretty"
)

// Io is the minimal write interface for CLI output.
type Io struct {
	Stdout func(text string)
	Stderr func(text string)
}

// ProcessIo returns an Io that writes to os.Stdout / os.Stderr.
func ProcessIo() Io {
	return Io{
		Stdout: func(s string) { fmt.Fprint(os.Stdout, s) },
		Stderr: func(s string) { fmt.Fprint(os.Stderr, s) },
	}
}

// ResolveMode converts the --output flag value to an OutputMode.
func ResolveMode(flag string) (OutputMode, error) {
	switch flag {
	case "", "pretty":
		return ModePretty, nil
	case "json":
		return ModeJSON, nil
	default:
		return "", &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("invalid output mode %q (pretty | json)", flag),
		}
	}
}

// EmitResult writes a result in the appropriate output mode.
func EmitResult(io Io, mode OutputMode, result any, pretty string) {
	if mode == ModeJSON {
		data, _ := json.Marshal(map[string]any{"ok": true, "result": result})
		io.Stdout(string(data) + "\n")
		return
	}
	if !strings.HasSuffix(pretty, "\n") {
		pretty += "\n"
	}
	io.Stdout(pretty)
}

// EmitError writes an error in the appropriate output mode.
func EmitError(io Io, mode OutputMode, e *core.MenvError) {
	if mode == ModeJSON {
		data, _ := json.Marshal(map[string]any{
			"ok": false,
			"error": map[string]any{
				"code":    string(e.Code),
				"message": e.Message,
				"details": e.Details,
			},
		})
		io.Stdout(string(data) + "\n")
		return
	}
	io.Stderr("menv: " + e.Message + "\n")
}

// PeekJSONMode inspects raw argv for --output=json before full parsing.
func PeekJSONMode(argv []string) OutputMode {
	for i, a := range argv {
		if a == "--output" && i+1 < len(argv) && argv[i+1] == "json" {
			return ModeJSON
		}
		if a == "--output=json" {
			return ModeJSON
		}
	}
	return ModePretty
}
