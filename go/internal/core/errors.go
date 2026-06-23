package core

import "fmt"

// MenvErrorCode is the stable error code included in JSON error envelopes
// and used for exit-code mapping.
type MenvErrorCode string

const (
	ErrValidation  MenvErrorCode = "VALIDATION"
	ErrParse       MenvErrorCode = "PARSE"
	ErrNotFound    MenvErrorCode = "NOT_FOUND"
	ErrAmbiguous   MenvErrorCode = "AMBIGUOUS"
	ErrBlocked     MenvErrorCode = "BLOCKED"
	ErrAuthMissing MenvErrorCode = "AUTH_MISSING"
	ErrAuthFailed  MenvErrorCode = "AUTH_FAILED"
	ErrVaultIO     MenvErrorCode = "VAULT_IO"
)

var exitCodes = map[MenvErrorCode]int{
	ErrValidation:  1,
	ErrParse:       1,
	ErrNotFound:    1,
	ErrAmbiguous:   1,
	ErrBlocked:     1,
	ErrAuthMissing: 3,
	ErrAuthFailed:  3,
	ErrVaultIO:     4,
}

// MenvError is the single error type used throughout menv. The Code drives
// exit code selection; Details carries structured context for JSON output.
type MenvError struct {
	Code    MenvErrorCode
	Message string
	Details any
}

func (e *MenvError) Error() string {
	return string(e.Code) + ": " + e.Message
}

func (e *MenvError) ExitCode() int {
	if code, ok := exitCodes[e.Code]; ok {
		return code
	}
	return 1
}

// Errorf creates a MenvError with a formatted message.
func Errorf(code MenvErrorCode, format string, args ...any) *MenvError {
	return &MenvError{Code: code, Message: fmt.Sprintf(format, args...)}
}
