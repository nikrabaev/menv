package ops

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/nikrabaev/menv/go/internal/core"
	"github.com/nikrabaev/menv/go/internal/registry"
)

// OpResult is the return type of every op planner: the would-be next registry
// plus the Plan describing how to reach it. Planners never mutate their input
// and never do I/O.
type OpResult struct {
	Next registry.Registry
	Plan core.Plan
}

var (
	SlugRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)
	NameRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

// CloneRegistry deep-clones a Registry via JSON round-trip.
func CloneRegistry(r registry.Registry) registry.Registry {
	b, _ := json.Marshal(r)
	var out registry.Registry
	_ = json.Unmarshal(b, &out)
	// Ensure nil maps become empty maps for consistent access patterns.
	if out.Vaults == nil {
		out.Vaults = map[string]registry.VaultDef{}
	}
	if out.Consumers == nil {
		out.Consumers = map[string]registry.ConsumerDef{}
	}
	if out.Groups == nil {
		out.Groups = map[string]registry.GroupDef{}
	}
	if out.Globals == nil {
		out.Globals = map[string]registry.GlobalDef{}
	}
	if out.Variables == nil {
		out.Variables = map[string]registry.VariableDef{}
	}
	if out.Compose.Files == nil {
		out.Compose.Files = []string{}
	}
	return out
}

// NewPlan returns a plan with all slices initialized (not nil).
func NewPlan() core.Plan {
	return core.EmptyPlan()
}

// MergePlans concatenates two plans section-by-section.
func MergePlans(a, b core.Plan) core.Plan {
	return core.MergePlans(a, b)
}

func knownList(names map[string]struct{}) string {
	keys := make([]string, 0, len(names))
	for k := range names {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return "none"
	}
	return strings.Join(keys, ", ")
}

func vaultNames(r registry.Registry) map[string]struct{} {
	m := make(map[string]struct{}, len(r.Vaults))
	for k := range r.Vaults {
		m[k] = struct{}{}
	}
	return m
}

func consumerNames(r registry.Registry) map[string]struct{} {
	m := make(map[string]struct{}, len(r.Consumers))
	for k := range r.Consumers {
		m[k] = struct{}{}
	}
	return m
}

func groupKeys(r registry.Registry) map[string]struct{} {
	m := make(map[string]struct{}, len(r.Groups))
	for k := range r.Groups {
		m[k] = struct{}{}
	}
	return m
}

func variableNames(r registry.Registry) map[string]struct{} {
	m := make(map[string]struct{}, len(r.Variables))
	for k := range r.Variables {
		m[k] = struct{}{}
	}
	return m
}

// RequireVault returns the VaultDef for name or a NOT_FOUND error.
func RequireVault(r registry.Registry, name string) (registry.VaultDef, error) {
	v, ok := r.Vaults[name]
	if !ok {
		return registry.VaultDef{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("unknown vault %q (known: %s)", name, knownList(vaultNames(r))),
		}
	}
	return v, nil
}

// RequireConsumer returns the ConsumerDef for name or a NOT_FOUND error.
func RequireConsumer(r registry.Registry, name string) (registry.ConsumerDef, error) {
	c, ok := r.Consumers[name]
	if !ok {
		return registry.ConsumerDef{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("unknown consumer %q (known: %s)", name, knownList(consumerNames(r))),
		}
	}
	return c, nil
}

// RequireGroup returns the GroupDef for key or a NOT_FOUND error.
func RequireGroup(r registry.Registry, key string) (registry.GroupDef, error) {
	g, ok := r.Groups[key]
	if !ok {
		return registry.GroupDef{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("unknown group %q (known: %s)", key, knownList(groupKeys(r))),
		}
	}
	return g, nil
}

// RequireVariable returns the VariableDef for name or a NOT_FOUND error.
func RequireVariable(r registry.Registry, name string) (registry.VariableDef, error) {
	v, ok := r.Variables[name]
	if !ok {
		return registry.VariableDef{}, &core.MenvError{
			Code:    core.ErrNotFound,
			Message: fmt.Sprintf("unknown variable %q (known: %s)", name, knownList(variableNames(r))),
		}
	}
	return v, nil
}

// RequireSlug validates that name matches the slug pattern for kind.
func RequireSlug(kind, name string) error {
	if !SlugRE.MatchString(name) {
		return &core.MenvError{
			Code:    core.ErrValidation,
			Message: fmt.Sprintf("invalid %s name %q (use a-z 0-9 . _ -)", kind, name),
		}
	}
	return nil
}
