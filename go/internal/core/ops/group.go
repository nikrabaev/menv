package ops

import (
	"fmt"
	"sort"

	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/registry"
)

// PlanGroupAdd registers a new group.
func PlanGroupAdd(r registry.Registry, input struct{ Key, Title string }) (OpResult, error) {
	if err := RequireSlug("group", input.Key); err != nil {
		return OpResult{}, err
	}
	if _, exists := r.Groups[input.Key]; exists {
		return OpResult{}, &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("group %q already exists", input.Key),
		}
	}
	next := CloneRegistry(r)
	next.Groups[input.Key] = registry.GroupDef{Title: input.Title}
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("groups.%s", input.Key),
		Summary: fmt.Sprintf("add group %q", input.Key),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// PlanGroupUpdate changes a group's title.
func PlanGroupUpdate(r registry.Registry, input struct{ Key, Title string }) (OpResult, error) {
	if _, err := RequireGroup(r, input.Key); err != nil {
		return OpResult{}, err
	}
	next := CloneRegistry(r)
	next.Groups[input.Key] = registry.GroupDef{Title: input.Title}
	plan := NewPlan()
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "set",
		Path:    fmt.Sprintf("groups.%s.title", input.Key),
		Summary: fmt.Sprintf("retitle group %q", input.Key),
	})
	return OpResult{Next: next, Plan: plan}, nil
}

// PlanGroupRemove removes a group and clears groupKey on all member variables.
func PlanGroupRemove(r registry.Registry, input struct{ Key string }) (OpResult, error) {
	if _, err := RequireGroup(r, input.Key); err != nil {
		return OpResult{}, err
	}
	next := CloneRegistry(r)
	plan := NewPlan()

	delete(next.Groups, input.Key)
	plan.Registry = append(plan.Registry, core.RegistryOp{
		Action:  "remove",
		Path:    fmt.Sprintf("groups.%s", input.Key),
		Summary: fmt.Sprintf("remove group %q", input.Key),
	})

	// Cascade: clear groupKey on all member variables.
	varNames := make([]string, 0, len(next.Variables))
	for n := range next.Variables {
		varNames = append(varNames, n)
	}
	sort.Strings(varNames)
	for _, varName := range varNames {
		def := next.Variables[varName]
		if def.GroupKey != input.Key {
			continue
		}
		def.GroupKey = ""
		next.Variables[varName] = def
		plan.Registry = append(plan.Registry, core.RegistryOp{
			Action:  "remove",
			Path:    fmt.Sprintf("variables.%s.groupKey", varName),
			Summary: fmt.Sprintf("clear group on %q", varName),
		})
		plan.Blockers = append(plan.Blockers, core.PlanIssue{
			Code:    "GROUP_IN_USE",
			Message: fmt.Sprintf("variable %q is in group %q", varName, input.Key),
		})
	}
	return OpResult{Next: next, Plan: plan}, nil
}
