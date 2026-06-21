package cli

import (
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"
)

// PromptMasked reads a password from the TTY, echoing * per character.
// Uses term.ReadPassword which handles raw mode and echo suppression.
func PromptMasked(label string) (string, error) {
	fmt.Fprint(os.Stderr, label)
	secret, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr) // newline after masked input
	if err != nil {
		return "", err
	}
	return string(secret), nil
}

// ReadValue reads a value from: the argument, piped stdin, or a masked prompt.
func ReadValue(arg string, argSet bool) (string, error) {
	if argSet {
		return arg, nil
	}
	if term.IsTerminal(int(os.Stdin.Fd())) {
		return PromptMasked("value: ")
	}
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(data), "\r\n"), nil
}

// IsTTY reports whether stdin is a terminal.
func IsTTY() bool {
	return term.IsTerminal(int(os.Stdin.Fd()))
}
