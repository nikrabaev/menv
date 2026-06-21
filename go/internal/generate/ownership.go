package generate

import "strings"

// OwnershipMarker is the exact first line of every menv-managed generated file.
// The ownership rule: menv only overwrites or deletes a file whose first line
// carries this marker. If the user removes it, the file belongs to them.
const OwnershipMarker = "# ── managed by menv ─ DO NOT EDIT ─"

// headerCommentLines is the number of comment lines in the disclaimer header
// (not counting the blank separator line).
const headerCommentLines = 3

// HeaderMeta carries optional metadata embedded in the generated header.
type HeaderMeta struct {
	Vault    string
	Consumer string
}

// DisclaimerHeader returns the 4-line header (marker + origin + advice + blank).
func DisclaimerHeader(meta HeaderMeta) string {
	var origin string
	if meta.Vault != "" && meta.Consumer != "" {
		origin = " · vault: " + meta.Vault + " · consumer: " + meta.Consumer
	} else if meta.Vault != "" {
		origin = " · vault: " + meta.Vault
	} else if meta.Consumer != "" {
		origin = " · consumer: " + meta.Consumer
	}
	return OwnershipMarker + "───────────────────────────\n" +
		"# Generated from menv.json" + origin + "\n" +
		"# Re-create with `menv generate`; your edits will be overwritten.\n" +
		"\n"
}

// HasOwnershipMarker reports whether content starts with the ownership marker.
func HasOwnershipMarker(content string) bool {
	return strings.HasPrefix(content, OwnershipMarker)
}

// StripDisclaimer removes exactly the 3-line header block plus blank separator.
func StripDisclaimer(content string) string {
	if !HasOwnershipMarker(content) {
		return content
	}
	lines := strings.Split(content, "\n")
	i := headerCommentLines
	if i < len(lines) && lines[i] == "" {
		i++
	}
	return strings.Join(lines[i:], "\n")
}

// HeaderVault extracts the vault name embedded in the header's origin line, or
// returns "" if the content is not menv-managed or has no vault annotation.
func HeaderVault(content string) string {
	if !HasOwnershipMarker(content) {
		return ""
	}
	lines := strings.SplitN(content, "\n", 3)
	if len(lines) < 2 {
		return ""
	}
	origin := lines[1]
	const needle = "vault: "
	idx := strings.Index(origin, needle)
	if idx == -1 {
		return ""
	}
	rest := origin[idx+len(needle):]
	// Stop at space or ·
	end := strings.IndexAny(rest, " ·")
	if end == -1 {
		return rest
	}
	return rest[:end]
}
