package tui

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"github.com/google/uuid"

	"github.com/nikrabaev/menv/go/internal/core/ops"
	"github.com/nikrabaev/menv/go/internal/generate"
	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/nikrabaev/menv/go/internal/registry"
)

func newKey() string { return uuid.New().String() }

func required(s string) error {
	if strings.TrimSpace(s) == "" {
		return errors.New("required")
	}
	return nil
}

// parsePairsLoose parses "<k>=<v>,<k2>=<v2>" into a map, ignoring blanks.
func parsePairsLoose(raw string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(raw, ",") {
		if i := strings.IndexByte(part, '='); i > 0 {
			out[strings.TrimSpace(part[:i])] = strings.TrimSpace(part[i+1:])
		}
	}
	return out
}

// formModalCmd builds a huh form modal sized to the terminal and pushes it.
func (a *App) formModalCmd(title string, danger bool, groups []*huh.Group, onSubmit func(a *App) tea.Cmd) tea.Cmd {
	form := huh.NewForm(groups...).
		WithShowHelp(true).
		WithWidth(a.modalFormWidth()).
		WithHeight(a.modalFormHeight())
	return a.pushModal(&formModal{title: title, danger: danger, form: form, onSubmit: onSubmit})
}

// newUnlockModal builds the passphrase modal (used by ensureUnlocked).
func (a *App) newUnlockModal(vault string, cont func(a *App) tea.Cmd) *unlockModal {
	secret := ""
	form := huh.NewForm(huh.NewGroup(
		huh.NewInput().Key("secret").Title("Passphrase for "+vault).
			EchoMode(huh.EchoModePassword).Value(&secret),
	)).WithShowHelp(false).WithWidth(a.modalFormWidth())
	return &unlockModal{vault: vault, secret: &secret, form: form, onUnlocked: cont}
}

// newConsumerPickModal builds the disambiguation picker (used by withConsumer).
func (a *App) newConsumerPickModal(consumers []string, onPick func(a *App, consumer string) tea.Cmd) *consumerPickModal {
	choice := ""
	if len(consumers) > 0 {
		choice = consumers[0]
	}
	form := huh.NewForm(huh.NewGroup(
		huh.NewSelect[string]().Key("c").Title("Consumer").
			Options(huh.NewOptions(consumers...)...).Value(&choice),
	)).WithShowHelp(false).WithWidth(a.modalFormWidth())
	return &consumerPickModal{form: form, choice: &choice, onPick: onPick}
}

// groupOptions returns select options for groups (with a "(none)" entry).
func (a *App) groupOptions() []huh.Option[string] {
	opts := []huh.Option[string]{huh.NewOption("(none)", "")}
	for _, k := range keysOf(a.reg.Groups) {
		opts = append(opts, huh.NewOption(k+" — "+a.reg.Groups[k].Title, k))
	}
	return opts
}

// ── vault ───────────────────────────────────────────────────────────────────

func (a *App) addVaultFlow() tea.Cmd {
	name, filename, encrypt := "", ".menv/vault.json", true
	onSubmit := func(a *App) tea.Cmd {
		op, err := ops.PlanVaultAdd(a.reg, ops.VaultAddInput{
			Name: name, VaultType: "menv-local",
			VaultConfig: map[string]any{"filename": filename, "encryption": encrypt},
		})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		var post func(root string) error
		if !encrypt {
			fn := filename
			post = func(root string) error { return menvio.UpsertManagedBlock(root, []string{fn}) }
		}
		return a.pushPlanPost("Add vault "+name, "added vault", op, post)
	}
	g := huh.NewGroup(
		huh.NewInput().Key("name").Title("Vault name").Value(&name).Validate(required),
		huh.NewInput().Key("filename").Title("Store filename").Value(&filename).Validate(required),
		huh.NewConfirm().Key("enc").Title("Encrypt with an age passphrase?").Value(&encrypt),
	)
	return a.formModalCmd("Add vault", false, []*huh.Group{g}, onSubmit)
}

func (a *App) editVaultFlow(name string) tea.Cmd {
	def := a.reg.Vaults[name]
	var cfg struct {
		Filename   string `json:"filename"`
		Encryption bool   `json:"encryption"`
	}
	_ = json.Unmarshal(def.VaultConfig, &cfg)
	filename, encrypt := cfg.Filename, cfg.Encryption
	onSubmit := func(a *App) tea.Cmd {
		op, err := ops.PlanVaultUpdate(a.reg, ops.VaultUpdateInput{
			Name:   name,
			Config: map[string]any{"filename": filename, "encryption": encrypt},
		})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		var post func(root string) error
		if !encrypt {
			fn := filename
			post = func(root string) error { return menvio.UpsertManagedBlock(root, []string{fn}) }
		}
		return a.pushPlanPost("Edit vault "+name, "updated vault", op, post)
	}
	g := huh.NewGroup(
		huh.NewInput().Key("filename").Title("Store filename").Value(&filename).Validate(required),
		huh.NewConfirm().Key("enc").Title("Encrypt with an age passphrase?").Value(&encrypt),
	)
	return a.formModalCmd("Edit vault "+name, false, []*huh.Group{g}, onSubmit)
}

func (a *App) setDefaultVault(name string) tea.Cmd {
	op, err := ops.PlanVaultUpdate(a.reg, ops.VaultUpdateInput{Name: name, MakeDefault: true})
	if err != nil {
		a.setStatus(statusErr, err.Error())
		return nil
	}
	return a.pushPlan("Set default vault", "set default", op)
}

func (a *App) removeVaultFlow(name string) tea.Cmd {
	op, err := ops.PlanVaultRemove(a.reg, struct{ Name string }{Name: name})
	if err != nil {
		a.setStatus(statusErr, err.Error())
		return nil
	}
	return a.pushPlan("Remove vault "+name, "removed vault", op)
}

// ── consumer ────────────────────────────────────────────────────────────────

func (a *App) addConsumerFlow() tea.Cmd {
	name, strategy, baseDir, filename, filenamesRaw := "", "single", "", ".env", ""
	secrets, example := false, false
	onSubmit := func(a *App) tea.Cmd {
		in := ops.ConsumerAddInput{
			Name: name, StrategyType: strategy, BaseDir: baseDir,
			SecretsAsLocalOverrides: secrets, Example: example,
		}
		if strategy == "single" {
			in.Filename = filename
		} else {
			in.Filenames = parsePairsLoose(filenamesRaw)
		}
		op, err := ops.PlanConsumerAdd(a.reg, in)
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		post := consumerGitignorePost(op.Next, name)
		return a.pushPlanPost("Add consumer "+name, "added consumer", op, post)
	}
	g := huh.NewGroup(
		huh.NewInput().Key("name").Title("Consumer name").Value(&name).Validate(required),
		huh.NewSelect[string]().Key("strategy").Title("Strategy").
			Options(huh.NewOptions("single", "per-vault")...).Value(&strategy),
		huh.NewInput().Key("baseDir").Title("Base directory").Value(&baseDir).Validate(required),
		huh.NewInput().Key("filename").Title("Filename (single strategy)").Value(&filename),
		huh.NewInput().Key("filenames").Title("Per-vault files (<vault>=<file>,…)").Value(&filenamesRaw),
		huh.NewConfirm().Key("secrets").Title("Write secrets to a .local override?").Value(&secrets),
		huh.NewConfirm().Key("example").Title("Also emit a committed .env.example?").Value(&example),
	)
	return a.formModalCmd("Add consumer", false, []*huh.Group{g}, onSubmit)
}

func (a *App) editConsumerFlow(name string) tea.Cmd {
	def := a.reg.Consumers[name]
	baseDir := def.StrategyConfig.BaseDir
	filename := def.StrategyConfig.Filename
	filenamesRaw := pairsToString(def.StrategyConfig.Filenames)
	secrets := def.StrategyConfig.SecretsAsLocalOverrides
	example := def.StrategyConfig.Example
	onSubmit := func(a *App) tea.Cmd {
		in := ops.ConsumerUpdateInput{
			Name:                    name,
			BaseDir:                 &baseDir,
			SecretsAsLocalOverrides: &secrets,
			Example:                 &example,
		}
		if def.StrategyType == "single" {
			in.Filename = &filename
		} else {
			in.Filenames = parsePairsLoose(filenamesRaw)
		}
		op, err := ops.PlanConsumerUpdate(a.reg, in)
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		post := consumerGitignorePost(op.Next, name)
		return a.pushPlanPost("Edit consumer "+name, "updated consumer", op, post)
	}
	fields := []huh.Field{
		huh.NewInput().Key("baseDir").Title("Base directory").Value(&baseDir).Validate(required),
	}
	if def.StrategyType == "single" {
		fields = append(fields, huh.NewInput().Key("filename").Title("Filename").Value(&filename))
	} else {
		fields = append(fields, huh.NewInput().Key("filenames").Title("Per-vault files (<vault>=<file>,…)").Value(&filenamesRaw))
	}
	fields = append(fields,
		huh.NewConfirm().Key("secrets").Title("Secrets → .local override?").Value(&secrets),
		huh.NewConfirm().Key("example").Title("Emit .env.example?").Value(&example),
	)
	return a.formModalCmd("Edit consumer "+name, false, []*huh.Group{huh.NewGroup(fields...)}, onSubmit)
}

func consumerGitignorePost(next registry.Registry, name string) func(root string) error {
	def, ok := next.Consumers[name]
	if !ok {
		return nil
	}
	p := generate.ConsumerPathsFor(def)
	entries := append(append([]string{}, p.Main...), p.Local...)
	if len(entries) == 0 {
		return nil
	}
	return func(root string) error { return menvio.UpsertManagedBlock(root, entries) }
}

func (a *App) removeConsumerFlow(name string) tea.Cmd {
	deleteFiles := false
	onSubmit := func(a *App) tea.Cmd {
		var paths []string
		if def, ok := a.reg.Consumers[name]; ok {
			cp := generate.ConsumerPathsFor(def)
			paths = append(paths, cp.Main...)
			paths = append(paths, cp.Local...)
			if cp.Example != "" {
				paths = append(paths, cp.Example)
			}
		}
		scan := a.scanFromRuntime(a.vaultsWiringConsumer(name))
		op, err := ops.PlanConsumerRemove(a.reg, ops.ConsumerRemoveInput{
			Name: name, Openable: scan.Openable, Paths: paths, DeleteFiles: deleteFiles,
		})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Remove consumer "+name, "removed consumer", op)
	}
	g := huh.NewGroup(
		huh.NewConfirm().Key("del").Title("Delete generated files? (No = release them)").Value(&deleteFiles),
	)
	return a.formModalCmd("Remove consumer "+name, true, []*huh.Group{g}, onSubmit)
}

// ── group ───────────────────────────────────────────────────────────────────

func (a *App) addGroupFlow() tea.Cmd {
	key, title := "", ""
	onSubmit := func(a *App) tea.Cmd {
		op, err := ops.PlanGroupAdd(a.reg, struct{ Key, Title string }{Key: key, Title: title})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Add group "+key, "added group", op)
	}
	g := huh.NewGroup(
		huh.NewInput().Key("key").Title("Group key").Value(&key).Validate(required),
		huh.NewInput().Key("title").Title("Title").Value(&title).Validate(required),
	)
	return a.formModalCmd("Add group", false, []*huh.Group{g}, onSubmit)
}

func (a *App) editGroupFlow(key string) tea.Cmd {
	title := a.reg.Groups[key].Title
	onSubmit := func(a *App) tea.Cmd {
		op, err := ops.PlanGroupUpdate(a.reg, struct{ Key, Title string }{Key: key, Title: title})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Edit group "+key, "updated group", op)
	}
	g := huh.NewGroup(huh.NewInput().Key("title").Title("Title").Value(&title).Validate(required))
	return a.formModalCmd("Edit group "+key, false, []*huh.Group{g}, onSubmit)
}

func (a *App) removeGroupFlow(key string) tea.Cmd {
	op, err := ops.PlanGroupRemove(a.reg, struct{ Key string }{Key: key})
	if err != nil {
		a.setStatus(statusErr, err.Error())
		return nil
	}
	return a.pushPlan("Remove group "+key, "removed group", op)
}

// ── global ──────────────────────────────────────────────────────────────────

func (a *App) defineGlobalFlow() tea.Cmd {
	name, source, value, desc := "", "runtime", "", ""
	onSubmit := func(a *App) tea.Cmd {
		op, err := ops.PlanGlobalDefine(a.reg, ops.GlobalWriteInput{
			Name: name, Vault: a.activeVault, Source: source, Value: value, Description: desc,
		})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Define global "+name, "defined global", op)
	}
	g := huh.NewGroup(
		huh.NewInput().Key("name").Title("Global name").Value(&name).Validate(required),
		huh.NewSelect[string]().Key("source").Title("Source").
			Options(huh.NewOptions("runtime", "static")...).Value(&source),
		huh.NewInput().Key("value").Title("Static value (when source = static)").Value(&value),
		huh.NewInput().Key("desc").Title("Description").Value(&desc),
	)
	return a.formModalCmd("Define global ("+a.activeVault+")", false, []*huh.Group{g}, onSubmit)
}

func (a *App) editGlobalFlow(name string) tea.Cmd {
	def := a.reg.Globals[name]
	cur, hasForVault := def.Values[a.activeVault]
	source, value, desc := "runtime", "", def.Description
	if hasForVault {
		source = cur.Source
		value = cur.Value
	}
	onSubmit := func(a *App) tea.Cmd {
		in := ops.GlobalWriteInput{Name: name, Vault: a.activeVault, Source: source, Value: value, Description: desc}
		var op ops.OpResult
		var err error
		if hasForVault {
			op, err = ops.PlanGlobalUpdate(a.reg, in)
		} else {
			op, err = ops.PlanGlobalDefine(a.reg, in)
		}
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Edit global "+name, "updated global", op)
	}
	g := huh.NewGroup(
		huh.NewSelect[string]().Key("source").Title("Source").
			Options(huh.NewOptions("runtime", "static")...).Value(&source),
		huh.NewInput().Key("value").Title("Static value (when source = static)").Value(&value),
		huh.NewInput().Key("desc").Title("Description").Value(&desc),
	)
	return a.formModalCmd("Edit global "+name+" ("+a.activeVault+")", false, []*huh.Group{g}, onSubmit)
}

func (a *App) removeGlobalFlow(name string) tea.Cmd {
	scope := a.activeVault
	onSubmit := func(a *App) tea.Cmd {
		vault := scope
		if scope == "*all*" {
			vault = ""
		}
		var affected []string
		if vault != "" {
			affected = []string{vault}
		} else {
			for v := range a.reg.Globals[name].Values {
				affected = append(affected, v)
			}
		}
		scan := a.scanFromRuntime(affected)
		op, err := ops.PlanGlobalRemove(a.reg, ops.GlobalRemoveInput{
			Name: name, Vault: vault, Records: scan.Records, Unverified: scan.Unverified,
		})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Remove global "+name, "removed global", op)
	}
	g := huh.NewGroup(
		huh.NewSelect[string]().Key("scope").Title("Remove from").
			Options(
				huh.NewOption("this vault ("+a.activeVault+")", a.activeVault),
				huh.NewOption("all vaults", "*all*"),
			).Value(&scope),
	)
	return a.formModalCmd("Remove global "+name, true, []*huh.Group{g}, onSubmit)
}

// ── compose ─────────────────────────────────────────────────────────────────

func (a *App) bindComposeFlow() tea.Cmd {
	file := ""
	onSubmit := func(a *App) tea.Cmd {
		if _, err := os.Stat(filepath.Join(a.ctx.Root, file)); os.IsNotExist(err) {
			a.setStatus(statusErr, "no such file: "+file)
			return nil
		}
		op, err := ops.PlanComposeBind(a.reg, struct{ File string }{File: file})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		dir := filepath.Dir(file)
		envCompose := ".env.compose"
		if dir != "." {
			envCompose = filepath.Join(dir, ".env.compose")
		}
		post := func(root string) error { return menvio.UpsertManagedBlock(root, []string{envCompose}) }
		return a.pushPlanPost("Bind compose "+file, "bound compose", op, post)
	}
	g := huh.NewGroup(huh.NewInput().Key("file").Title("Compose file path").Value(&file).Validate(required))
	return a.formModalCmd("Bind compose file", false, []*huh.Group{g}, onSubmit)
}

func (a *App) unbindComposeFlow(file string) tea.Cmd {
	op, err := ops.PlanComposeUnbind(a.reg, struct{ File string }{File: file})
	if err != nil {
		a.setStatus(statusErr, err.Error())
		return nil
	}
	return a.pushPlan("Unbind compose "+file, "unbound compose", op)
}

// ── variable: define / edit / remove ────────────────────────────────────────

func (a *App) defineVarFlow() tea.Cmd {
	name, group, desc, example := "", "", "", ""
	secret := false
	onSubmit := func(a *App) tea.Cmd {
		in := ops.VarDefineInput{Name: name, GroupKey: group, Description: desc, Example: example}
		in.Secret = &secret
		op, err := ops.PlanVarDefine(a.reg, in)
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Define "+name, "defined variable", op)
	}
	g := huh.NewGroup(
		huh.NewInput().Key("name").Title("Variable name").Value(&name).Validate(required),
		huh.NewSelect[string]().Key("group").Title("Group").Options(a.groupOptions()...).Value(&group),
		huh.NewConfirm().Key("secret").Title("Secret?").Value(&secret),
		huh.NewInput().Key("desc").Title("Description").Value(&desc),
		huh.NewInput().Key("example").Title("Example value").Value(&example),
	)
	return a.formModalCmd("Define variable", false, []*huh.Group{g}, onSubmit)
}

func (a *App) editVarFlow(name string) tea.Cmd {
	def := a.reg.Variables[name]
	group, desc, example := def.GroupKey, def.Description, def.Example
	secret := def.Secret
	onSubmit := func(a *App) tea.Cmd {
		in := ops.VarUpdateInput{Name: name, Description: &desc, Example: &example, Secret: &secret}
		if group == "" {
			in.ClearGroup = true
		} else {
			in.GroupKey = group
		}
		op, err := ops.PlanVarUpdate(a.reg, in)
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Edit "+name, "updated variable", op)
	}
	g := huh.NewGroup(
		huh.NewSelect[string]().Key("group").Title("Group").Options(a.groupOptions()...).Value(&group),
		huh.NewConfirm().Key("secret").Title("Secret?").Value(&secret),
		huh.NewInput().Key("desc").Title("Description").Value(&desc),
		huh.NewInput().Key("example").Title("Example value").Value(&example),
	)
	return a.formModalCmd("Edit "+name, false, []*huh.Group{g}, onSubmit)
}

func (a *App) removeVarFlow(name string) tea.Cmd {
	scan := a.scanFromRuntime(a.vaultsWiringVariable(name))
	op, err := ops.PlanVarRemove(a.reg, ops.VarRemoveInput{
		Name: name, Records: scan.Records, Unverified: scan.Unverified, Openable: scan.Openable,
	})
	if err != nil {
		a.setStatus(statusErr, err.Error())
		return nil
	}
	return a.pushPlan("Remove "+name, "removed variable", op)
}

// ── variable: wire / unwire ─────────────────────────────────────────────────

func (a *App) wireFlow(name string) tea.Cmd {
	consumersRaw, mode, key := "", "fresh", ""
	onSubmit := func(a *App) tea.Cmd {
		consumers := splitCSV(consumersRaw)
		in := ops.WireInput{
			Name: name, Vault: a.activeVault, Consumers: consumers, NewKey: newKey,
		}
		switch mode {
		case "shared":
			in.Shared = true
		case "existing":
			in.Key = key
		}
		scan := a.scanFromRuntime([]string{a.activeVault})
		in.Openable = scan.Openable
		in.RemoveOrphans = true
		op, err := ops.PlanWire(a.reg, in)
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		return a.pushPlan("Wire "+name, "wired", op)
	}
	g := huh.NewGroup(
		huh.NewInput().Key("consumers").Title("Consumers (comma-separated)").Value(&consumersRaw).Validate(required),
		huh.NewSelect[string]().Key("mode").Title("Key mode").
			Options(
				huh.NewOption("fresh — a new key per consumer", "fresh"),
				huh.NewOption("shared — one new key for all", "shared"),
				huh.NewOption("existing — re-key onto a key", "existing"),
			).Value(&mode),
		huh.NewInput().Key("key").Title("Existing key (when mode = existing)").Value(&key),
	)
	return a.formModalCmd("Wire "+name+" ("+a.activeVault+")", false, []*huh.Group{g}, onSubmit)
}

// unwireFlow handles consumer selection then orphan disambiguation.
func (a *App) unwireFlow(name string, preset []string) tea.Cmd {
	if len(preset) > 0 {
		return a.unwireWith(name, preset)
	}
	wired := a.wiredConsumers(name)
	if len(wired) == 0 {
		a.setStatus(statusErr, name+" is not wired in "+a.activeVault)
		return nil
	}
	var chosen []string
	form := huh.NewForm(huh.NewGroup(
		huh.NewMultiSelect[string]().Key("c").Title("Unwire which consumers?").
			Options(huh.NewOptions(wired...)...).Value(&chosen),
	)).WithShowHelp(true).WithWidth(a.modalFormWidth())
	onSubmit := func(a *App) tea.Cmd {
		if len(chosen) == 0 {
			return nil
		}
		return a.unwireWith(name, chosen)
	}
	return a.pushModal(&formModal{title: "Unwire " + name, form: form, onSubmit: onSubmit})
}

func (a *App) unwireWith(name string, consumers []string) tea.Cmd {
	scan := a.scanFromRuntime([]string{a.activeVault})
	build := func(removeOrphans bool) (ops.OpResult, error) {
		return ops.PlanUnwire(a.reg, ops.UnwireInput{
			Name: name, Vault: a.activeVault, Consumers: consumers,
			Records: scan.Records, Unverified: scan.Unverified, Openable: scan.Openable,
			RemoveOrphans: removeOrphans,
		})
	}
	noRemove, err := build(false)
	if err != nil {
		a.setStatus(statusErr, err.Error())
		return nil
	}
	withRemove, err := build(true)
	if err != nil {
		a.setStatus(statusErr, err.Error())
		return nil
	}
	var orphanKeys []string
	for _, vop := range withRemove.Plan.Vaults {
		if vop.Action == "remove" {
			orphanKeys = append(orphanKeys, vop.Key)
		}
	}
	if len(orphanKeys) > 0 && a.vaultUnlocked(a.activeVault) {
		sort.Strings(orphanKeys)
		return a.pushModal(&orphanPromptModal{
			keys: orphanKeys,
			onChoose: func(a *App, remove bool) tea.Cmd {
				if remove {
					return a.pushPlan("Unwire "+name, "unwired", withRemove)
				}
				return a.pushPlan("Unwire "+name, "unwired", noRemove)
			},
		})
	}
	return a.pushPlan("Unwire "+name, "unwired", noRemove)
}

func (a *App) wiredConsumers(name string) []string {
	def := a.reg.Variables[name]
	var out []string
	for c := range def.VaultMapping[a.activeVault] {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

// ── variable: set / reveal / toggle ─────────────────────────────────────────

func (a *App) setValueFlow(name, preset string) tea.Cmd {
	return a.ensureUnlocked(a.activeVault, func(a *App) tea.Cmd {
		return a.withConsumer(name, preset, func(a *App, consumer string) tea.Cmd {
			value := ""
			secret := a.reg.Variables[name].Secret
			input := huh.NewInput().Key("v").Title("Value for " + name + " / " + consumer).Value(&value)
			if secret {
				input = input.EchoMode(huh.EchoModePassword)
			}
			onSubmit := func(a *App) tea.Cmd {
				op, err := ops.PlanSetValue(a.reg, ops.SetValueInput{
					KeyQuery: ops.KeyQuery{Name: name, Vault: a.activeVault, Consumer: consumer},
					Value:    value,
				})
				if err != nil {
					a.setStatus(statusErr, err.Error())
					return nil
				}
				return a.pushPlan("Set "+name, "set value", op)
			}
			form := huh.NewForm(huh.NewGroup(input)).WithShowHelp(false).WithWidth(a.modalFormWidth())
			return a.pushModal(&formModal{title: "Set " + name, form: form, onSubmit: onSubmit})
		})
	})
}

func (a *App) revealValueFlow(name, preset string) tea.Cmd {
	return a.ensureUnlocked(a.activeVault, func(a *App) tea.Cmd {
		return a.withConsumer(name, preset, func(a *App, consumer string) tea.Cmd {
			reveal := func(a *App) tea.Cmd {
				key, _, err := ops.ResolveMappingKey(a.reg, ops.KeyQuery{Name: name, Vault: a.activeVault, Consumer: consumer})
				if err != nil {
					a.setStatus(statusErr, err.Error())
					return nil
				}
				val := a.vaultValues(a.activeVault)[key]
				return a.pushModal(&revealModal{title: name + " / " + consumer, value: val})
			}
			if a.reg.Variables[name].Secret {
				return a.pushModal(&confirmModal{
					title:  "Reveal secret?",
					body:   "This shows the plaintext value of a secret.",
					danger: true,
					onYes:  reveal,
				})
			}
			return reveal(a)
		})
	})
}

func (a *App) toggleDisabledFlow(name, preset string) tea.Cmd {
	return a.withConsumer(name, preset, func(a *App, consumer string) tea.Cmd {
		entry, ok := a.reg.Variables[name].VaultMapping[a.activeVault][consumer]
		if !ok {
			a.setStatus(statusErr, "not wired")
			return nil
		}
		op, err := ops.PlanSetDisabled(a.reg, ops.SetDisabledInput{
			Name: name, Vault: a.activeVault, Consumer: consumer, Disabled: !entry.Disabled,
		})
		if err != nil {
			a.setStatus(statusErr, err.Error())
			return nil
		}
		verb := "disable"
		if entry.Disabled {
			verb = "enable"
		}
		return a.pushPlan(verb+" "+name, verb+"d", op)
	})
}

// ── import ──────────────────────────────────────────────────────────────────

func (a *App) importFlow() tea.Cmd {
	consumers := keysOf(a.reg.Consumers)
	vaults := keysOf(a.reg.Vaults)
	if len(consumers) == 0 || len(vaults) == 0 {
		a.setStatus(statusErr, "need at least one consumer and vault to import")
		return nil
	}
	file := ""
	consumer := consumers[0]
	vault := a.activeVault
	onSubmit := func(a *App) tea.Cmd {
		return a.ensureUnlocked(vault, func(a *App) tea.Cmd {
			data, err := os.ReadFile(filepath.Join(a.ctx.Root, file))
			if err != nil {
				a.setStatus(statusErr, "cannot read "+file)
				return nil
			}
			entries := menvio.ParseDotenv(string(data))
			cur := map[string]string{}
			rt := a.vaults[vault]
			for _, e := range entries {
				if vd, ok := a.reg.Variables[e.Key]; ok {
					if me, ok := vd.VaultMapping[vault][consumer]; ok && rt != nil {
						if v, ok := rt.values[me.Key]; ok {
							cur[me.Key] = v
						}
					}
				}
			}
			imp := make([]ops.DotenvEntry, len(entries))
			for i, e := range entries {
				imp[i] = ops.DotenvEntry{Key: e.Key, Value: e.Value}
			}
			op, report, err := ops.PlanImportEntries(a.reg, ops.ImportInput{
				Entries: imp, Consumer: consumer, Vault: vault, CurrentValues: cur, NewKey: newKey,
			})
			if err != nil {
				a.setStatus(statusErr, err.Error())
				return nil
			}
			label := fmt.Sprintf("import: %d defined, %d wired, %d updated",
				len(report.Defined), len(report.Wired), len(report.Updated))
			return a.pushPlan("Import "+file, label, op)
		})
	}
	g := huh.NewGroup(
		huh.NewInput().Key("file").Title("Dotenv file path").Value(&file).Validate(required),
		huh.NewSelect[string]().Key("consumer").Title("Consumer").Options(huh.NewOptions(consumers...)...).Value(&consumer),
		huh.NewSelect[string]().Key("vault").Title("Vault").Options(huh.NewOptions(vaults...)...).Value(&vault),
	)
	return a.formModalCmd("Import dotenv", false, []*huh.Group{g}, onSubmit)
}

// ── value edit (human mode) ─────────────────────────────────────────────────

func (a *App) valueEditFlow(name, consumer string) tea.Cmd {
	return a.ensureUnlocked(a.activeVault, func(a *App) tea.Cmd {
		def := a.reg.Variables[name]
		entry := def.VaultMapping[a.activeVault][consumer]
		secret := def.Secret
		value := ""
		disabled := entry.Disabled
		adopt := "" // "" = keep own key

		input := huh.NewInput().Key("v").Title("New value (blank keeps current)").Value(&value)
		if secret {
			input = input.EchoMode(huh.EchoModePassword)
		}
		adoptOpts := []huh.Option[string]{huh.NewOption("(keep own key)", "")}
		seen := map[string]bool{}
		for c, e := range def.VaultMapping[a.activeVault] {
			if c == consumer || seen[e.Key] {
				continue
			}
			seen[e.Key] = true
			adoptOpts = append(adoptOpts, huh.NewOption("share with "+c, e.Key))
		}

		onSubmit := func(a *App) tea.Cmd {
			plan := ops.OpResult{Next: a.reg, Plan: ops.NewPlan()}
			haveChange := false
			// adopt key (re-key onto a shared key)
			if adopt != "" && adopt != entry.Key {
				wireOp, err := ops.PlanWire(a.reg, ops.WireInput{
					Name: name, Vault: a.activeVault, Consumers: []string{consumer},
					Key: adopt, NewKey: newKey,
				})
				if err != nil {
					a.setStatus(statusErr, err.Error())
					return nil
				}
				plan = wireOp
				haveChange = true
			} else if value != "" {
				valOp, err := ops.PlanSetUniqueValue(a.reg, ops.SetUniqueValueInput{
					Name: name, Vault: a.activeVault, Consumer: consumer, Value: value, NewKey: newKey,
				})
				if err != nil {
					a.setStatus(statusErr, err.Error())
					return nil
				}
				plan = valOp
				haveChange = true
			}
			if disabled != entry.Disabled {
				disOp, err := ops.PlanSetDisabled(a.reg, ops.SetDisabledInput{
					Name: name, Vault: a.activeVault, Consumer: consumer, Disabled: disabled,
				})
				if err != nil {
					a.setStatus(statusErr, err.Error())
					return nil
				}
				plan = ops.OpResult{Next: disOp.Next, Plan: ops.MergePlans(plan.Plan, disOp.Plan)}
				haveChange = true
			}
			if !haveChange {
				a.setStatus(statusInfo, "no changes")
				return nil
			}
			return a.pushPlan("Edit "+name+" / "+consumer, "updated value", plan)
		}

		fields := []huh.Field{input}
		if len(adoptOpts) > 1 {
			fields = append(fields, huh.NewSelect[string]().Key("adopt").Title("Adopt a shared key").Options(adoptOpts...).Value(&adopt))
		}
		fields = append(fields, huh.NewConfirm().Key("disabled").Title("Disabled?").Value(&disabled))
		form := huh.NewForm(huh.NewGroup(fields...)).WithShowHelp(true).WithWidth(a.modalFormWidth())
		return a.pushModal(&formModal{title: "Edit " + name + " / " + consumer, form: form, onSubmit: onSubmit})
	})
}

// ── small helpers ───────────────────────────────────────────────────────────

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func pairsToString(m map[string]string) string {
	if len(m) == 0 {
		return ""
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = k + "=" + m[k]
	}
	return strings.Join(parts, ",")
}
