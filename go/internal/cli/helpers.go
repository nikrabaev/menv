package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// readFileSafe reads a file; returns nil data (not error) if the file is absent.
func readFileSafe(abs string) ([]byte, error) {
	data, err := os.ReadFile(abs)
	if os.IsNotExist(err) {
		return nil, nil
	}
	return data, err
}

func unmarshalJSON(data json.RawMessage, v any) error {
	return json.Unmarshal(data, v)
}

// parsePairs splits "k=v,k2=v2" into a map.
func parsePairs(raw, flag string) (map[string]string, error) {
	out := map[string]string{}
	if raw == "" {
		return out, nil
	}
	for _, part := range strings.Split(raw, ",") {
		idx := strings.IndexByte(part, '=')
		if idx < 1 {
			return nil, fmt.Errorf("%s expects <key>=<value>[,…], got %q", flag, part)
		}
		out[strings.TrimSpace(part[:idx])] = strings.TrimSpace(part[idx+1:])
	}
	return out, nil
}

// parseConfig converts "k=v" pairs to a JSON-compatible map, coercing "true"/"false".
func parseConfig(raw string) (json.RawMessage, error) {
	pairs, err := parsePairs(raw, "--config")
	if err != nil {
		return nil, err
	}
	m := map[string]any{}
	for k, v := range pairs {
		switch v {
		case "true":
			m[k] = true
		case "false":
			m[k] = false
		default:
			m[k] = v
		}
	}
	return json.Marshal(m)
}

// splitList splits a comma-separated list and trims whitespace.
func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
