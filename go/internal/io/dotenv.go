package io

import "strings"

// DotenvEntry is a key=value pair parsed from a .env file.
type DotenvEntry struct {
	Key   string
	Value string
}

// ParseDotenv parses dotenv-format text: strips comments, blank lines, and
// optional surrounding quotes. No escape-sequence processing (v2 keeps single-
// line values only). The `export ` prefix is accepted and stripped.
func ParseDotenv(text string) []DotenvEntry {
	var out []DotenvEntry
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		body := line
		if strings.HasPrefix(body, "export ") {
			body = strings.TrimSpace(body[len("export "):])
		}
		eq := strings.IndexByte(body, '=')
		if eq == -1 {
			continue
		}
		key := strings.TrimSpace(body[:eq])
		value := strings.TrimSpace(body[eq+1:])
		if len(value) >= 2 &&
			((value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
		} else {
			// Inline comment: strip everything from " #" onward.
			if idx := strings.Index(value, " #"); idx != -1 {
				value = strings.TrimRight(value[:idx], " \t")
			}
		}
		out = append(out, DotenvEntry{Key: key, Value: value})
	}
	return out
}
