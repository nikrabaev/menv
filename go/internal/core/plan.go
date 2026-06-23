package core

import (
	"fmt"
	"strings"
)

// RegistryOp describes a single mutation to menv.json.
type RegistryOp struct {
	Action  string `json:"action"`  // "set" | "remove"
	Path    string `json:"path"`    // dotted path, e.g. "variables.DATABASE_URL"
	Summary string `json:"summary"` // human-readable description
}

// VaultOp describes a single key operation in a vault.
// Value is NEVER serialized to JSON — secrets must never land in plans.
type VaultOp struct {
	Vault  string `json:"vault"`
	Action string `json:"action"` // "set" | "remove"
	Key    string `json:"key"`
	Value  string `json:"-"` // stripped from all JSON output — security invariant
}

// FileOp describes a file system operation on a generated file.
type FileOp struct {
	Action string `json:"action"` // "write" | "delete" | "release"
	Path   string `json:"path"`
}

// PlanIssue is a blocker or warning attached to a plan.
type PlanIssue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Plan is the complete computed diff for one mutation. Blockers prevent
// execution unless --force; warnings are always surfaced.
type Plan struct {
	Registry []RegistryOp `json:"registry"`
	Vaults   []VaultOp   `json:"vaults"`
	Files    []FileOp    `json:"files"`
	Blockers []PlanIssue `json:"blockers"`
	Warnings []PlanIssue `json:"warnings"`
}

// EmptyPlan returns a plan with all slices initialized (not nil).
func EmptyPlan() Plan {
	return Plan{
		Registry: []RegistryOp{},
		Vaults:   []VaultOp{},
		Files:    []FileOp{},
		Blockers: []PlanIssue{},
		Warnings: []PlanIssue{},
	}
}

// MergePlans concatenates two plans section-by-section.
func MergePlans(a, b Plan) Plan {
	return Plan{
		Registry: append(append([]RegistryOp{}, a.Registry...), b.Registry...),
		Vaults:   append(append([]VaultOp{}, a.Vaults...), b.Vaults...),
		Files:    append(append([]FileOp{}, a.Files...), b.Files...),
		Blockers: append(append([]PlanIssue{}, a.Blockers...), b.Blockers...),
		Warnings: append(append([]PlanIssue{}, a.Warnings...), b.Warnings...),
	}
}

// RenderPlanPretty returns a human-readable summary of the plan.
func RenderPlanPretty(plan Plan) string {
	var lines []string
	for _, op := range plan.Registry {
		lines = append(lines, fmt.Sprintf("registry %s %s — %s", op.Action, op.Path, op.Summary))
	}
	for _, op := range plan.Vaults {
		lines = append(lines, fmt.Sprintf("vault %s: %s %s", op.Vault, op.Action, op.Key))
	}
	for _, op := range plan.Files {
		lines = append(lines, fmt.Sprintf("file %s %s", op.Action, op.Path))
	}
	for _, w := range plan.Warnings {
		lines = append(lines, fmt.Sprintf("⚠ %s: %s", w.Code, w.Message))
	}
	for _, b := range plan.Blockers {
		lines = append(lines, fmt.Sprintf("✖ %s: %s", b.Code, b.Message))
	}
	if len(lines) == 0 {
		return "no changes"
	}
	return strings.Join(lines, "\n")
}

// VaultSession is the minimal interface needed by ExecutePlan to apply vault ops.
// The vault package implements this — defined here to avoid import cycles.
type VaultSession interface {
	Get(key string) (string, bool, error)
	Set(key, value string) error
	Remove(key string) error
	List() ([]string, error)
	Close() error
}

// ExecuteContext provides the callbacks and sessions needed to apply a Plan.
type ExecuteContext struct {
	Force          bool
	Sessions       map[string]VaultSession
	CommitRegistry func() error // called last; nil = skip
	ApplyFileOp    func(FileOp) error // nil = file ops stay descriptive
}

// ExecutePlan runs vault ops, then file ops, then commits the registry.
// A failed vault op leaves orphan keys, which `menv check` will report.
func ExecutePlan(plan Plan, ctx ExecuteContext) error {
	if len(plan.Blockers) > 0 && !ctx.Force {
		parts := make([]string, len(plan.Blockers))
		for i, b := range plan.Blockers {
			parts[i] = b.Code + ": " + b.Message
		}
		return &MenvError{
			Code:    ErrBlocked,
			Message: "blocked — " + strings.Join(parts, "; ") + " (use --force to override)",
			Details: plan.Blockers,
		}
	}
	for _, op := range plan.Vaults {
		sess, ok := ctx.Sessions[op.Vault]
		if !ok {
			return &MenvError{
				Code:    ErrVaultIO,
				Message: fmt.Sprintf("no open session for vault %q", op.Vault),
			}
		}
		switch op.Action {
		case "set":
			if err := sess.Set(op.Key, op.Value); err != nil {
				return err
			}
		case "remove":
			if err := sess.Remove(op.Key); err != nil {
				return err
			}
		}
	}
	if ctx.ApplyFileOp != nil {
		for _, op := range plan.Files {
			if err := ctx.ApplyFileOp(op); err != nil {
				return err
			}
		}
	}
	if ctx.CommitRegistry != nil {
		return ctx.CommitRegistry()
	}
	return nil
}
