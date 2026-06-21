package ops

import (
	"fmt"
	"strings"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/registry"
)

// PlanComposeBind registers a compose file in the registry.
func PlanComposeBind(r registry.Registry, input struct{ File string }) (OpResult, error) {
	for _, f := range r.Compose.Files {
		if f == input.File {
			return OpResult{}, &core.MenvError{
				Code:    core.ErrValidation,
				Message: fmt.Sprintf("%q is already bound", input.File),
			}
		}
	}
	next := CloneRegistry(r)
	next.Compose.Files = append(next.Compose.Files, input.File)
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    "compose.files",
		Summary: fmt.Sprintf("bind compose file %q", input.File),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// PlanComposeUnbind removes a compose file from the registry.
func PlanComposeUnbind(r registry.Registry, input struct{ File string }) (OpResult, error) {
	found := false
	for _, f := range r.Compose.Files {
		if f == input.File {
			found = true
			break
		}
	}
	if !found {
		bound := strings.Join(r.Compose.Files, ", ")
		if bound == "" {
			bound = "none"
		}
		return OpResult{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("%q is not bound (bound: %s)", input.File, bound),
		}
	}
	next := CloneRegistry(r)
	filtered := make([]string, 0, len(next.Compose.Files)-1)
	for _, f := range next.Compose.Files {
		if f != input.File {
			filtered = append(filtered, f)
		}
	}
	next.Compose.Files = filtered
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "remove",
		Path:    "compose.files",
		Summary: fmt.Sprintf("unbind compose file %q", input.File),
	})
	return OpResult{Next: next, Plan: plan}, nil
}
