package io

import (
	"os"
	"path/filepath"
	"strings"
)

const (
	gitignoreBegin = "# menv (managed block)"
	gitignoreEnd   = "# end menv"
)

// UpsertManagedBlock idempotently maintains menv's block in .gitignore.
// Entries are unioned (set semantics, original order kept); lines outside
// the block are left untouched.
func UpsertManagedBlock(root string, entries []string) error {
	path := filepath.Join(root, ".gitignore")
	data, err := os.ReadFile(path)
	text := ""
	if err == nil {
		text = string(data)
	} else if !os.IsNotExist(err) {
		return err
	}

	lines := strings.Split(text, "\n")
	begin := indexOf(lines, gitignoreBegin)
	end := -1
	if begin != -1 {
		end = indexOfFrom(lines, gitignoreEnd, begin)
	}

	existing := []string{}
	if begin != -1 && end != -1 {
		existing = lines[begin+1 : end]
	}
	merged := append([]string{}, existing...)
	for _, e := range entries {
		if !contains(merged, e) {
			merged = append(merged, e)
		}
	}
	block := append([]string{gitignoreBegin}, append(merged, gitignoreEnd)...)

	var out []string
	if begin != -1 && end != -1 {
		out = append(lines[:begin:begin], append(block, lines[end+1:]...)...)
	} else {
		// Append after existing content (with a blank separator if needed).
		head := lines
		if text == "" {
			head = nil
		} else {
			// Trim trailing empty line to avoid double-blank.
			if len(head) > 0 && head[len(head)-1] == "" {
				head = head[:len(head)-1]
			}
			head = append(head, "") // blank separator
		}
		out = append(head, append(block, "")...)
	}
	return WriteFileAtomic(root, ".gitignore", []byte(strings.Join(out, "\n")))
}

func indexOf(lines []string, s string) int {
	for i, l := range lines {
		if l == s {
			return i
		}
	}
	return -1
}

func indexOfFrom(lines []string, s string, from int) int {
	for i := from; i < len(lines); i++ {
		if lines[i] == s {
			return i
		}
	}
	return -1
}

func contains(lines []string, s string) bool {
	for _, l := range lines {
		if l == s {
			return true
		}
	}
	return false
}
