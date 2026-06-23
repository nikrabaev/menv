package core

// ValueRecord holds one raw vault value for dependency scanning.
type ValueRecord struct {
	Variable string
	Vault    string
	Consumer string
	Raw      string
}

// Dependent is a (variable, vault, consumer) triple that references a target.
type Dependent struct {
	Variable string
	Vault    string
	Consumer string
}

// FindDependents returns all records whose raw value contains a ${target} ref.
func FindDependents(target string, records []ValueRecord) []Dependent {
	var out []Dependent
	for _, r := range records {
		for _, ref := range ExtractRefs(r.Raw) {
			if ref == target {
				out = append(out, Dependent{
					Variable: r.Variable,
					Vault:    r.Vault,
					Consumer: r.Consumer,
				})
				break
			}
		}
	}
	return out
}
