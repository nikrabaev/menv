package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nikrabaev/menv/internal/core"
	"github.com/nikrabaev/menv/internal/core/ops"
	"github.com/nikrabaev/menv/internal/generate"
	menvio "github.com/nikrabaev/menv/internal/io"
	"github.com/nikrabaev/menv/internal/registry"
	"github.com/nikrabaev/menv/internal/vault"
	"github.com/spf13/cobra"
)

// BuildProgram constructs the full cobra command tree.
// root is the menv.json directory; newKey generates vault mapping keys.
func BuildProgram(root string, io Io, newKey func() string) *cobra.Command {
	if newKey == nil {
		newKey = func() string { return uuid.New().String() }
	}

	// Global flags.
	var dryRun bool
	var force bool
	var outputFlag string
	var vaultAuthPairs []string

	// Computed from flags — called after cobra has parsed.
	getFlags := func() (MutationFlags, error) {
		mode, err := ResolveMode(outputFlag)
		if err != nil {
			return MutationFlags{}, err
		}
		authMap, err := ParseVaultAuth(vaultAuthPairs)
		if err != nil {
			return MutationFlags{}, err
		}
		return MutationFlags{DryRun: dryRun, Force: force, Mode: mode, VaultAuth: authMap}, nil
	}

	var promptFn PromptFn
	if IsTTY() {
		promptFn = func(vaultName string) (string, error) {
			return PromptMasked(fmt.Sprintf(`key for vault "%s": `, vaultName))
		}
	}

	loadReg := func() (registry.Registry, error) {
		return registry.LoadRegistry(root)
	}

	emit := func(flags MutationFlags, result any, pretty string) {
		EmitResult(io, flags.Mode, result, pretty)
	}

	rootCmd := &cobra.Command{
		Use:           "menv",
		Short:         "environment variables across a monorepo — registry + pluggable vaults (v2)",
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	rootCmd.PersistentFlags().BoolVar(&dryRun, "dry-run", false, "compute and print the plan without applying it")
	rootCmd.PersistentFlags().BoolVar(&force, "force", false, "override blockers")
	rootCmd.PersistentFlags().StringVarP(&outputFlag, "output", "o", "", "output mode: pretty | json")
	rootCmd.PersistentFlags().StringArrayVar(&vaultAuthPairs, "vault-auth", nil, "vault auth as <vault>=<secret> (repeatable)")

	// ── init ──────────────────────────────────────────────────────────────
	{
		var encrypt bool
		cmd := &cobra.Command{
			Use:   "init",
			Short: "create an empty menv.json and the local vault config",
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				result, err := runInit(root, encrypt)
				if err != nil {
					return err
				}
				emit(flags, result, "initialized: "+strings.Join(result["created"].([]string), ", "))
				return nil
			},
		}
		cmd.Flags().BoolVar(&encrypt, "encrypt", true, "encrypt the local vault (use --encrypt=false for plaintext)")
		rootCmd.AddCommand(cmd)
	}

	// ── vault ──────────────────────────────────────────────────────────────
	vaultCmd := &cobra.Command{Use: "vault", Short: "manage vaults (value stores)"}
	{
		var vaultType, configRaw string
		cmd := &cobra.Command{
			Use:   "add <name>",
			Short: "add a vault",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				if _, err := vault.GetProvider(vaultType); err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				cfgRaw, err := parseConfig(configRaw)
				if err != nil {
					return err
				}
				var cfgMap map[string]any
				_ = json.Unmarshal(cfgRaw, &cfgMap)
				op, err := ops.PlanVaultAdd(reg, ops.VaultAddInput{Name: args[0], VaultType: vaultType, VaultConfig: cfgMap})
				if err != nil {
					return err
				}
				if err := RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn); err != nil {
					return err
				}
				if !flags.DryRun && vaultType == "menv-local" {
					var localCfg struct {
						Filename   string `json:"filename"`
						Encryption bool   `json:"encryption"`
					}
					if json.Unmarshal(cfgRaw, &localCfg) == nil && !localCfg.Encryption && localCfg.Filename != "" {
						_ = menvio.UpsertManagedBlock(root, []string{localCfg.Filename})
					}
				}
				return nil
			},
		}
		cmd.Flags().StringVar(&vaultType, "type", "", "provider type (menv-local)")
		_ = cmd.MarkFlagRequired("type")
		cmd.Flags().StringVar(&configRaw, "config", "", "provider config as <key>=<value>[,…]")
		vaultCmd.AddCommand(cmd)
	}
	{
		var configRaw string
		var makeDefault bool
		cmd := &cobra.Command{
			Use:  "update <name>",
			Args: cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				var cfgMap map[string]any
				if configRaw != "" {
					cfgJSON, e := parseConfig(configRaw)
					if e != nil {
						return e
					}
					_ = json.Unmarshal(cfgJSON, &cfgMap)
				}
				op, err := ops.PlanVaultUpdate(reg, ops.VaultUpdateInput{Name: args[0], Config: cfgMap, MakeDefault: makeDefault})
				if err != nil {
					return err
				}
				return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
			},
		}
		cmd.Flags().StringVar(&configRaw, "config", "", "provider config keys to merge")
		cmd.Flags().BoolVar(&makeDefault, "default", false, "make this the default vault")
		vaultCmd.AddCommand(cmd)
	}
	vaultCmd.AddCommand(&cobra.Command{
		Use:  "remove <name>",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			op, err := ops.PlanVaultRemove(reg, struct{ Name string }{Name: args[0]})
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
		},
	})
	vaultCmd.AddCommand(&cobra.Command{
		Use:  "list",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			var lines []string
			names := sortedKeys(reg.Vaults)
			for _, n := range names {
				d := reg.Vaults[n]
				suffix := ""
				if reg.Defaults.Vault == n {
					suffix = " [default]"
				}
				lines = append(lines, fmt.Sprintf("%s (%s)%s", n, d.VaultType, suffix))
			}
			pretty := strings.Join(lines, "\n")
			if pretty == "" {
				pretty = "no vaults"
			}
			emit(flags, map[string]any{"defaults": reg.Defaults, "vaults": reg.Vaults}, pretty)
			return nil
		},
	})
	vaultCmd.AddCommand(&cobra.Command{
		Use:  "show <name>",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			def, ok := reg.Vaults[args[0]]
			if !ok {
				return &core.MenvError{Code: core.ErrNotFound, Message: fmt.Sprintf("unknown vault %q", args[0])}
			}
			data, _ := json.MarshalIndent(def, "", "  ")
			emit(flags, def, string(data))
			return nil
		},
	})
	rootCmd.AddCommand(vaultCmd)

	// ── consumer ──────────────────────────────────────────────────────────
	consumerCmd := &cobra.Command{Use: "consumer", Short: "manage consumers (recipients of generated files)"}
	{
		var strategy, baseDir, filename, filenamesRaw string
		var secretsAsLocalOverrides, example, noGitignore bool
		cmd := &cobra.Command{
			Use:  "add <name>",
			Args: cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				if strategy != "single" && strategy != "per-vault" {
					return &core.MenvError{Code: core.ErrValidation, Message: fmt.Sprintf("--strategy must be \"single\" or \"per-vault\", got %q", strategy)}
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				var filenames map[string]string
				if filenamesRaw != "" {
					filenames, err = parsePairs(filenamesRaw, "--filenames")
					if err != nil {
						return err
					}
				}
				inp := ops.ConsumerAddInput{
					Name:                    args[0],
					StrategyType:            strategy,
					BaseDir:                 baseDir,
					Filename:                filename,
					Filenames:               filenames,
					SecretsAsLocalOverrides: secretsAsLocalOverrides,
					Example:                 example,
				}
				op, err := ops.PlanConsumerAdd(reg, inp)
				if err != nil {
					return err
				}
				if err := RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn); err != nil {
					return err
				}
				if !flags.DryRun {
					if def, ok := op.Next.Consumers[args[0]]; ok {
						paths := generate.ConsumerPathsFor(def)
						var entries []string
						if noGitignore {
							entries = paths.Local
						} else {
							entries = append(paths.Main, paths.Local...)
						}
						if len(entries) > 0 {
							_ = menvio.UpsertManagedBlock(root, entries)
						}
					}
				}
				return nil
			},
		}
		cmd.Flags().StringVar(&strategy, "strategy", "", "single | per-vault")
		_ = cmd.MarkFlagRequired("strategy")
		cmd.Flags().StringVar(&baseDir, "base-dir", "", "directory the files are generated into")
		_ = cmd.MarkFlagRequired("base-dir")
		cmd.Flags().StringVar(&filename, "filename", "", "(single) the generated file name")
		cmd.Flags().StringVar(&filenamesRaw, "filenames", "", "(per-vault) <vault>=<file>[,…]")
		cmd.Flags().BoolVar(&secretsAsLocalOverrides, "secrets-as-local-overrides", false, "write secrets to <file>.local")
		cmd.Flags().BoolVar(&example, "example", false, "also emit a committed .env.example")
		cmd.Flags().BoolVar(&noGitignore, "no-gitignore", false, "do not append generated paths to .gitignore")
		consumerCmd.AddCommand(cmd)
	}
	{
		var baseDir, filename, filenamesRaw string
		var secretsAsLocalOverrides, example, noGitignore bool
		cmd := &cobra.Command{
			Use:  "update <name>",
			Args: cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				inp := ops.ConsumerUpdateInput{Name: args[0]}
				if cmd.Flags().Changed("base-dir") {
					inp.BaseDir = &baseDir
				}
				if cmd.Flags().Changed("filename") {
					inp.Filename = &filename
				}
				if cmd.Flags().Changed("filenames") {
					pairs, err := parsePairs(filenamesRaw, "--filenames")
					if err != nil {
						return err
					}
					inp.Filenames = pairs
				}
				if cmd.Flags().Changed("secrets-as-local-overrides") {
					inp.SecretsAsLocalOverrides = &secretsAsLocalOverrides
				}
				if cmd.Flags().Changed("example") {
					inp.Example = &example
				}
				op, err := ops.PlanConsumerUpdate(reg, inp)
				if err != nil {
					return err
				}
				if err := RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn); err != nil {
					return err
				}
				if !flags.DryRun {
					if def, ok := op.Next.Consumers[args[0]]; ok {
						paths := generate.ConsumerPathsFor(def)
						var entries []string
						if noGitignore {
							entries = paths.Local
						} else {
							entries = append(paths.Main, paths.Local...)
						}
						if len(entries) > 0 {
							_ = menvio.UpsertManagedBlock(root, entries)
						}
					}
				}
				return nil
			},
		}
		cmd.Flags().StringVar(&baseDir, "base-dir", "", "new base directory")
		cmd.Flags().StringVar(&filename, "filename", "", "new file name")
		cmd.Flags().StringVar(&filenamesRaw, "filenames", "", "new per-vault filenames")
		cmd.Flags().BoolVar(&secretsAsLocalOverrides, "secrets-as-local-overrides", false, "")
		cmd.Flags().BoolVar(&example, "example", false, "")
		cmd.Flags().BoolVar(&noGitignore, "no-gitignore", false, "")
		consumerCmd.AddCommand(cmd)
	}
	{
		var deleteFiles bool
		cmd := &cobra.Command{
			Use:  "remove <name>",
			Args: cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				def, hasDef := reg.Consumers[args[0]]
				var paths []string
				if hasDef {
					cp := generate.ConsumerPathsFor(def)
					paths = append(paths, cp.Main...)
					paths = append(paths, cp.Local...)
					if cp.Example != "" {
						paths = append(paths, cp.Example)
					}
				}
				wired := vaultsWiringConsumer(reg, args[0])
				scan, err := CollectValueRecords(root, reg, wired, flags, promptFn)
				if err != nil {
					return err
				}
				op, err := ops.PlanConsumerRemove(reg, ops.ConsumerRemoveInput{
					Name:        args[0],
					Openable:    scan.Openable,
					Paths:       paths,
					DeleteFiles: deleteFiles,
				})
				if err != nil {
					return err
				}
				return RunMutation(root, reg, op, flags, io, scan.Sessions, MutationExtras{
					ApplyFileOp: func(fop core.FileOp) error {
						return generate.ApplyFileOp(root, fop)
					},
				}, promptFn)
			},
		}
		cmd.Flags().BoolVar(&deleteFiles, "delete-files", false, "delete generated files instead of releasing them")
		consumerCmd.AddCommand(cmd)
	}
	consumerCmd.AddCommand(&cobra.Command{
		Use:  "list",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			var lines []string
			for _, n := range sortedKeys(reg.Consumers) {
				d := reg.Consumers[n]
				lines = append(lines, fmt.Sprintf("%s — %s, %s", n, d.StrategyType, d.StrategyConfig.BaseDir))
			}
			pretty := strings.Join(lines, "\n")
			if pretty == "" {
				pretty = "no consumers"
			}
			emit(flags, reg.Consumers, pretty)
			return nil
		},
	})
	consumerCmd.AddCommand(&cobra.Command{
		Use:  "show <name>",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			def, ok := reg.Consumers[args[0]]
			if !ok {
				return &core.MenvError{Code: core.ErrNotFound, Message: fmt.Sprintf("unknown consumer %q", args[0])}
			}
			data, _ := json.MarshalIndent(def, "", "  ")
			emit(flags, def, string(data))
			return nil
		},
	})
	rootCmd.AddCommand(consumerCmd)

	// ── group ──────────────────────────────────────────────────────────────
	groupCmd := &cobra.Command{Use: "group", Short: "manage organizational groups"}
	{
		var title string
		cmd := &cobra.Command{Use: "add <key>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			op, err := ops.PlanGroupAdd(reg, struct{ Key, Title string }{Key: args[0], Title: title})
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&title, "title", "", "group title")
		_ = cmd.MarkFlagRequired("title")
		groupCmd.AddCommand(cmd)
	}
	{
		var title string
		cmd := &cobra.Command{Use: "update <key>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			op, err := ops.PlanGroupUpdate(reg, struct{ Key, Title string }{Key: args[0], Title: title})
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&title, "title", "", "new group title")
		_ = cmd.MarkFlagRequired("title")
		groupCmd.AddCommand(cmd)
	}
	groupCmd.AddCommand(&cobra.Command{Use: "remove <key>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		op, err := ops.PlanGroupRemove(reg, struct{ Key string }{Key: args[0]})
		if err != nil {
			return err
		}
		return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
	}})
	groupCmd.AddCommand(&cobra.Command{Use: "list", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		var lines []string
		for _, k := range sortedKeys(reg.Groups) {
			lines = append(lines, fmt.Sprintf("%s — %s", k, reg.Groups[k].Title))
		}
		pretty := strings.Join(lines, "\n")
		if pretty == "" {
			pretty = "no groups"
		}
		emit(flags, reg.Groups, pretty)
		return nil
	}})
	rootCmd.AddCommand(groupCmd)

	// ── global ────────────────────────────────────────────────────────────
	globalCmd := &cobra.Command{Use: "global", Short: "manage globals (platform-provided or static names)"}
	addGlobalCmd := func(use string, runE func(name, vaultName, source string, value, desc *string, flags MutationFlags, reg registry.Registry) error) *cobra.Command {
		var vaultName, value, desc string
		var runtime bool
		cmd := &cobra.Command{Use: use + " <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			if runtime == (cmd.Flags().Changed("value")) {
				return &core.MenvError{Code: core.ErrValidation, Message: "pass exactly one of --runtime or --value"}
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			source := "static"
			if runtime {
				source = "runtime"
			}
			var vp, dp *string
			if cmd.Flags().Changed("value") {
				vp = &value
			}
			if cmd.Flags().Changed("description") {
				dp = &desc
			}
			return runE(args[0], vaultName, source, vp, dp, flags, reg)
		}}
		cmd.Flags().StringVar(&vaultName, "vault", "", "vault name")
		_ = cmd.MarkFlagRequired("vault")
		cmd.Flags().BoolVar(&runtime, "runtime", false, "the platform provides this name at run/deploy time")
		cmd.Flags().StringVar(&value, "value", "", "static value menv substitutes at generate time")
		cmd.Flags().StringVar(&desc, "description", "", "")
		return cmd
	}
	globalCmd.AddCommand(addGlobalCmd("define", func(name, vaultName, source string, value, desc *string, flags MutationFlags, reg registry.Registry) error {
		inp := ops.GlobalWriteInput{Name: name, Vault: vaultName, Source: source}
		if value != nil {
			inp.Value = *value
		}
		if desc != nil {
			inp.Description = *desc
		}
		op, err := ops.PlanGlobalDefine(reg, inp)
		if err != nil {
			return err
		}
		return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
	}))
	globalCmd.AddCommand(addGlobalCmd("update", func(name, vaultName, source string, value, desc *string, flags MutationFlags, reg registry.Registry) error {
		inp := ops.GlobalWriteInput{Name: name, Vault: vaultName, Source: source}
		if value != nil {
			inp.Value = *value
		}
		if desc != nil {
			inp.Description = *desc
		}
		op, err := ops.PlanGlobalUpdate(reg, inp)
		if err != nil {
			return err
		}
		return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
	}))
	{
		var vaultName string
		cmd := &cobra.Command{Use: "remove <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			var affected []string
			if vaultName != "" {
				affected = []string{vaultName}
			} else {
				for v := range reg.Globals[args[0]].Values {
					affected = append(affected, v)
				}
			}
			scan, err := CollectValueRecords(root, reg, affected, flags, promptFn)
			if err != nil {
				return err
			}
			op, err := ops.PlanGlobalRemove(reg, ops.GlobalRemoveInput{
				Name:       args[0],
				Vault:      vaultName,
				Records:    scan.Records,
				Unverified: scan.Unverified,
			})
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, scan.Sessions, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&vaultName, "vault", "", "remove only this vault's entry")
		globalCmd.AddCommand(cmd)
	}
	globalCmd.AddCommand(&cobra.Command{Use: "list", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		var lines []string
		for _, n := range sortedKeys(reg.Globals) {
			g := reg.Globals[n]
			var parts []string
			for v, d := range g.Values {
				parts = append(parts, v+": "+d.Source)
			}
			sort.Strings(parts)
			lines = append(lines, n+" — "+strings.Join(parts, ", "))
		}
		pretty := strings.Join(lines, "\n")
		if pretty == "" {
			pretty = "no globals"
		}
		emit(flags, reg.Globals, pretty)
		return nil
	}})
	rootCmd.AddCommand(globalCmd)

	// ── compose ───────────────────────────────────────────────────────────
	composeCmd := &cobra.Command{Use: "compose", Short: "manage bound docker-compose files"}
	composeCmd.AddCommand(&cobra.Command{Use: "bind <file>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		abs := filepath.Join(root, args[0])
		if _, err := os.Stat(abs); os.IsNotExist(err) {
			return &core.MenvError{Code: core.ErrNotFound, Message: fmt.Sprintf("no such file: %s", args[0])}
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		op, err := ops.PlanComposeBind(reg, struct{ File string }{File: args[0]})
		if err != nil {
			return err
		}
		if err := RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn); err != nil {
			return err
		}
		if !flags.DryRun {
			dir := filepath.Dir(args[0])
			var envCompose string
			if dir == "." {
				envCompose = ".env.compose"
			} else {
				envCompose = filepath.Join(dir, ".env.compose")
			}
			_ = menvio.UpsertManagedBlock(root, []string{envCompose})
		}
		return nil
	}})
	composeCmd.AddCommand(&cobra.Command{Use: "unbind <file>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		op, err := ops.PlanComposeUnbind(reg, struct{ File string }{File: args[0]})
		if err != nil {
			return err
		}
		return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
	}})
	composeCmd.AddCommand(&cobra.Command{Use: "list", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		pretty := strings.Join(reg.Compose.Files, "\n")
		if pretty == "" {
			pretty = "no compose files bound"
		}
		emit(flags, reg.Compose, pretty)
		return nil
	}})
	rootCmd.AddCommand(composeCmd)

	// ── generate ──────────────────────────────────────────────────────────
	{
		var genVault, genConsumer string
		cmd := &cobra.Command{
			Use:   "generate",
			Short: "regenerate .env files (and compose) from the vault",
			Args:  cobra.NoArgs,
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				return runGenerate(root, reg, generate.GenerateOpts{Vault: genVault, Consumer: genConsumer}, flags, io, promptFn)
			},
		}
		cmd.Flags().StringVar(&genVault, "vault", "", "vault to materialize")
		cmd.Flags().StringVar(&genConsumer, "consumer", "", "limit to one consumer")
		rootCmd.AddCommand(cmd)
	}

	// ── check ─────────────────────────────────────────────────────────────
	rootCmd.AddCommand(&cobra.Command{
		Use:   "check",
		Short: "validate the repo (CI gate; exit 1 on findings)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			return RunCheck(root, reg, flags, io)
		},
	})

	// ── var ───────────────────────────────────────────────────────────────
	varCmd := &cobra.Command{Use: "var", Short: "manage variable definitions"}
	{
		var group, desc, example string
		var secret bool
		cmd := &cobra.Command{Use: "define <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			inp := ops.VarDefineInput{Name: args[0]}
			if cmd.Flags().Changed("group") {
				inp.GroupKey = group
			}
			if cmd.Flags().Changed("secret") {
				inp.Secret = &secret
			}
			if cmd.Flags().Changed("description") {
				inp.Description = desc
			}
			if cmd.Flags().Changed("example") {
				inp.Example = example
			}
			op, err := ops.PlanVarDefine(reg, inp)
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&group, "group", "", "group key")
		cmd.Flags().BoolVar(&secret, "secret", false, "mark as secret")
		cmd.Flags().StringVar(&desc, "description", "", "")
		cmd.Flags().StringVar(&example, "example", "", "")
		varCmd.AddCommand(cmd)
	}
	{
		var group, desc, example string
		var secret bool
		cmd := &cobra.Command{Use: "update <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			inp := ops.VarUpdateInput{Name: args[0]}
			if cmd.Flags().Changed("group") {
				if group == "" {
					inp.ClearGroup = true
				} else {
					inp.GroupKey = group
				}
			}
			if cmd.Flags().Changed("secret") {
				inp.Secret = &secret
			}
			if cmd.Flags().Changed("description") {
				inp.Description = &desc
			}
			if cmd.Flags().Changed("example") {
				inp.Example = &example
			}
			op, err := ops.PlanVarUpdate(reg, inp)
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&group, "group", "", `new group ("" clears it)`)
		cmd.Flags().BoolVar(&secret, "secret", false, "")
		cmd.Flags().StringVar(&desc, "description", "", "")
		cmd.Flags().StringVar(&example, "example", "", "")
		varCmd.AddCommand(cmd)
	}
	varCmd.AddCommand(&cobra.Command{Use: "remove <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		def, ok := reg.Variables[args[0]]
		var wired []string
		if ok {
			for v := range def.VaultMapping {
				wired = append(wired, v)
			}
		}
		scan, err := CollectValueRecords(root, reg, wired, flags, promptFn)
		if err != nil {
			return err
		}
		op, err := ops.PlanVarRemove(reg, ops.VarRemoveInput{
			Name:       args[0],
			Records:    scan.Records,
			Unverified: scan.Unverified,
			Openable:   scan.Openable,
		})
		if err != nil {
			return err
		}
		return RunMutation(root, reg, op, flags, io, scan.Sessions, MutationExtras{}, promptFn)
	}})
	{
		var filterVault, filterConsumer, filterGroup string
		cmd := &cobra.Command{Use: "list", Args: cobra.NoArgs, RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			var lines []string
			for _, n := range sortedKeys(reg.Variables) {
				def := reg.Variables[n]
				if filterGroup != "" && def.GroupKey != filterGroup {
					continue
				}
				if filterVault != "" {
					if _, ok := def.VaultMapping[filterVault]; !ok {
						continue
					}
				}
				if filterConsumer != "" {
					found := false
					for _, byConsumer := range def.VaultMapping {
						if _, ok := byConsumer[filterConsumer]; ok {
							found = true
							break
						}
					}
					if !found {
						continue
					}
				}
				var parts []string
				for _, v := range sortedKeys(def.VaultMapping) {
					cs := make([]string, 0)
					for c := range def.VaultMapping[v] {
						cs = append(cs, c)
					}
					sort.Strings(cs)
					parts = append(parts, v+": "+strings.Join(cs, ","))
				}
				wiring := strings.Join(parts, " · ")
				if wiring == "" {
					wiring = "unwired"
				}
				suffix := ""
				if def.GroupKey != "" {
					suffix += " [" + def.GroupKey + "]"
				}
				if def.Secret {
					suffix += " secret"
				}
				lines = append(lines, n+suffix+" — "+wiring)
			}
			pretty := strings.Join(lines, "\n")
			if pretty == "" {
				pretty = "no variables"
			}
			emit(flags, reg.Variables, pretty)
			return nil
		}}
		cmd.Flags().StringVar(&filterVault, "vault", "", "filter by vault")
		cmd.Flags().StringVar(&filterConsumer, "consumer", "", "filter by consumer")
		cmd.Flags().StringVar(&filterGroup, "group", "", "filter by group key")
		varCmd.AddCommand(cmd)
	}
	varCmd.AddCommand(&cobra.Command{Use: "show <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		flags, err := getFlags()
		if err != nil {
			return err
		}
		reg, err := loadReg()
		if err != nil {
			return err
		}
		def, ok := reg.Variables[args[0]]
		if !ok {
			return &core.MenvError{Code: core.ErrNotFound, Message: fmt.Sprintf("unknown variable %q", args[0])}
		}
		data, _ := json.MarshalIndent(def, "", "  ")
		emit(flags, def, string(data))
		return nil
	}})
	rootCmd.AddCommand(varCmd)

	// ── wire / unwire / enable / disable ──────────────────────────────────
	{
		var wireVault, consumers, wireKey string
		var shared, removeOrphans bool
		cmd := &cobra.Command{Use: "wire <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			var scan *ValueScan
			if removeOrphans {
				s, err := CollectValueRecords(root, reg, []string{wireVault}, flags, promptFn)
				if err != nil {
					return err
				}
				scan = &s
			}
			var sessions map[string]core.VaultSession
			var openable map[string]bool
			if scan != nil {
				sessions = scan.Sessions
				openable = scan.Openable
			}
			op, err := ops.PlanWire(reg, ops.WireInput{
				Name:          args[0],
				Vault:         wireVault,
				Consumers:     splitList(consumers),
				Shared:        shared,
				Key:           wireKey,
				NewKey:        newKey,
				RemoveOrphans: removeOrphans,
				Openable:      openable,
			})
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, sessions, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&wireVault, "vault", "", "target vault")
		_ = cmd.MarkFlagRequired("vault")
		cmd.Flags().StringVar(&consumers, "consumers", "", "comma-separated consumer list")
		_ = cmd.MarkFlagRequired("consumers")
		cmd.Flags().BoolVar(&shared, "shared", false, "one shared key for all listed consumers")
		cmd.Flags().StringVar(&wireKey, "key", "", "use this existing vault key")
		cmd.Flags().BoolVar(&removeOrphans, "remove-orphans", false, "drop a vault key left unused after re-keying")
		rootCmd.AddCommand(cmd)
	}
	{
		var wireVault, consumers string
		var removeOrphans bool
		cmd := &cobra.Command{Use: "unwire <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			scan, err := CollectValueRecords(root, reg, []string{wireVault}, flags, promptFn)
			if err != nil {
				return err
			}
			op, err := ops.PlanUnwire(reg, ops.UnwireInput{
				Name:          args[0],
				Vault:         wireVault,
				Consumers:     splitList(consumers),
				Records:       scan.Records,
				Unverified:    scan.Unverified,
				Openable:      scan.Openable,
				RemoveOrphans: removeOrphans,
			})
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, scan.Sessions, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&wireVault, "vault", "", "target vault")
		_ = cmd.MarkFlagRequired("vault")
		cmd.Flags().StringVar(&consumers, "consumers", "", "comma-separated consumer list")
		_ = cmd.MarkFlagRequired("consumers")
		cmd.Flags().BoolVar(&removeOrphans, "remove-orphans", false, "drop vault keys left unused after the unwire")
		rootCmd.AddCommand(cmd)
	}
	for _, pair := range []struct {
		verb     string
		disabled bool
	}{{"enable", false}, {"disable", true}} {
		disabled := pair.disabled
		var disableVault, disableConsumer string
		cmd := &cobra.Command{Use: pair.verb + " <name>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			op, err := ops.PlanSetDisabled(reg, ops.SetDisabledInput{
				Name:     args[0],
				Vault:    disableVault,
				Consumer: disableConsumer,
				Disabled: disabled,
			})
			if err != nil {
				return err
			}
			return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
		}}
		cmd.Flags().StringVar(&disableVault, "vault", "", "target vault")
		_ = cmd.MarkFlagRequired("vault")
		cmd.Flags().StringVar(&disableConsumer, "consumer", "", "target consumer")
		_ = cmd.MarkFlagRequired("consumer")
		rootCmd.AddCommand(cmd)
	}

	// ── set / get ─────────────────────────────────────────────────────────
	{
		var setVault, setConsumer string
		cmd := &cobra.Command{
			Use:   "set <name> [value]",
			Short: "set a value — from the arg, piped stdin, or a masked TTY prompt",
			Args:  cobra.RangeArgs(1, 2),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				vaultName := setVault
				if vaultName == "" {
					vaultName = reg.Defaults.Vault
				}
				var value string
				if len(args) >= 2 {
					value = args[1]
				} else {
					value, err = ReadValue("", false)
					if err != nil {
						return err
					}
				}
				op, err := ops.PlanSetValue(reg, ops.SetValueInput{
					KeyQuery: ops.KeyQuery{Name: args[0], Vault: vaultName, Consumer: setConsumer},
					Value:    value,
				})
				if err != nil {
					return err
				}
				return RunMutation(root, reg, op, flags, io, nil, MutationExtras{}, promptFn)
			},
		}
		cmd.Flags().StringVar(&setVault, "vault", "", "target vault")
		cmd.Flags().StringVar(&setConsumer, "consumer", "", "needed only when keys differ per consumer")
		rootCmd.AddCommand(cmd)
	}
	{
		var getVault, getConsumer string
		cmd := &cobra.Command{
			Use:   "get <name>",
			Short: "print the raw value (secrets included) — pipeable",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				vaultName := getVault
				if vaultName == "" {
					vaultName = reg.Defaults.Vault
				}
				key, _, err := ops.ResolveMappingKey(reg, ops.KeyQuery{Name: args[0], Vault: vaultName, Consumer: getConsumer})
				if err != nil {
					return err
				}
				sess, err := OpenVaultSession(root, reg, vaultName, flags, promptFn)
				if err != nil {
					return err
				}
				defer sess.Close()
				val, found, err := sess.Get(key)
				if err != nil {
					return err
				}
				if !found {
					return &core.MenvError{Code: core.ErrNotFound, Message: fmt.Sprintf("no value stored for %q in vault %q", args[0], vaultName)}
				}
				if flags.Mode == ModeJSON {
					EmitResult(io, ModeJSON, map[string]any{"name": args[0], "vault": vaultName, "value": val}, val)
				} else {
					io.Stdout(val)
				}
				return nil
			},
		}
		cmd.Flags().StringVar(&getVault, "vault", "", "")
		cmd.Flags().StringVar(&getConsumer, "consumer", "", "")
		rootCmd.AddCommand(cmd)
	}

	// ── import ────────────────────────────────────────────────────────────
	{
		var importConsumer, importVault string
		cmd := &cobra.Command{
			Use:   "import <file>",
			Short: "ingest an existing dotenv file: define + wire + set",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				reg, err := loadReg()
				if err != nil {
					return err
				}
				return runImport(root, reg, args[0], importConsumer, importVault, flags, io, newKey, promptFn)
			},
		}
		cmd.Flags().StringVar(&importConsumer, "consumer", "", "target consumer")
		_ = cmd.MarkFlagRequired("consumer")
		cmd.Flags().StringVar(&importVault, "vault", "", "target vault")
		_ = cmd.MarkFlagRequired("vault")
		rootCmd.AddCommand(cmd)
	}

	// ── backup / restore ──────────────────────────────────────────────────
	rootCmd.AddCommand(&cobra.Command{
		Use:   "backup",
		Short: "snapshot menv.json, vault files, and generated files into .menv/backups",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			flags, err := getFlags()
			if err != nil {
				return err
			}
			reg, err := loadReg()
			if err != nil {
				return err
			}
			return runBackup(root, reg, flags, io)
		},
	})
	{
		var restoreKey string
		cmd := &cobra.Command{
			Use:   "restore [key]",
			Short: "restore a backup (omit key to pick on a TTY; --force skips confirmation)",
			Args:  cobra.MaximumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				flags, err := getFlags()
				if err != nil {
					return err
				}
				if len(args) > 0 {
					restoreKey = args[0]
				}
				return runRestore(root, restoreKey, flags, io)
			},
		}
		rootCmd.AddCommand(cmd)
	}

	return rootCmd
}

// ── command implementations ────────────────────────────────────────────────

func runInit(root string, encrypt bool) (map[string]any, error) {
	regPath := filepath.Join(root, registry.RegistryFilename)
	if _, err := os.Stat(regPath); err == nil {
		return nil, &core.MenvError{Code: core.ErrValidation, Message: registry.RegistryFilename + " already exists"}
	}
	if _, err := os.Stat(filepath.Join(root, "menv.toml")); err == nil {
		return nil, &core.MenvError{Code: core.ErrValidation, Message: "v1 repo detected (menv.toml) — v2 has no migration; remove the v1 files first"}
	}

	var vaultCfg json.RawMessage
	if encrypt {
		vaultCfg, _ = json.Marshal(map[string]any{"filename": ".menv/vault.json", "encryption": true})
	} else {
		vaultCfg, _ = json.Marshal(map[string]any{"filename": ".menv/vault.json", "encryption": false})
	}
	reg := registry.Registry{
		SchemaVersion: 2,
		Defaults:      registry.Defaults{Vault: "local"},
		Vaults: map[string]registry.VaultDef{
			"local": {VaultType: "menv-local", VaultConfig: vaultCfg},
		},
		Consumers: map[string]registry.ConsumerDef{},
		Groups:    map[string]registry.GroupDef{},
		Globals:   map[string]registry.GlobalDef{},
		Variables: map[string]registry.VariableDef{},
		Compose:   registry.Compose{Files: []string{}},
	}
	if err := registry.SaveRegistry(root, reg); err != nil {
		return nil, err
	}
	ignores := []string{".menv/auth.local.json", ".menv/backups/"}
	if !encrypt {
		ignores = append(ignores, ".menv/vault.json")
	}
	if err := menvio.UpsertManagedBlock(root, ignores); err != nil {
		return nil, err
	}
	return map[string]any{"created": []string{registry.RegistryFilename, ".gitignore (menv block)"}}, nil
}

func runGenerate(root string, reg registry.Registry, opts generate.GenerateOpts, flags MutationFlags, io Io, promptFn PromptFn) error {
	runCompose := opts.Consumer == "" && len(reg.Compose.Files) > 0
	vaultSet := map[string]bool{}
	for _, v := range generate.VaultsNeeded(reg, opts) {
		vaultSet[v] = true
	}
	if runCompose {
		vaultSet[coalesce(opts.Vault, reg.Defaults.Vault)] = true
	}
	sessions := map[string]core.VaultSession{}
	defer func() {
		for _, s := range sessions {
			_ = s.Close()
		}
	}()
	vaults := sortedStringSet(vaultSet)
	for _, v := range vaults {
		sess, err := OpenVaultSession(root, reg, v, flags, promptFn)
		if err != nil {
			return err
		}
		sessions[v] = sess
	}

	envPreview, err := generate.PreviewGenerate(root, reg, opts, sessions)
	if err != nil {
		return err
	}

	type composeResult struct {
		Writes   []generate.FileWrite
		Errors   []core.PlanIssue
		Warnings []core.PlanIssue
	}
	var compRes composeResult
	if runCompose {
		cp, err := generate.PreviewCompose(root, reg, opts, sessions)
		if err != nil {
			return err
		}
		if len(cp.Errors) > 0 {
			msgs := make([]string, len(cp.Errors))
			for i, e := range cp.Errors {
				msgs[i] = e.Message
			}
			return &core.MenvError{Code: core.ErrValidation, Message: "compose: " + strings.Join(msgs, "; "), Details: cp.Errors}
		}
		compRes = composeResult{Writes: cp.Writes, Errors: cp.Errors, Warnings: cp.Warnings}
	}

	writes := append(envPreview.Writes, compRes.Writes...)
	warnings := append(envPreview.Warnings, compRes.Warnings...)
	written := make([]string, len(writes))
	for i, w := range writes {
		written[i] = w.Path
	}
	result := map[string]any{
		"written":   written,
		"unchanged": envPreview.Unchanged,
		"refused":   envPreview.Refused,
		"warnings":  warnings,
	}

	if flags.DryRun {
		result["dryRun"] = true
		EmitResult(io, flags.Mode, result, prettyGenerate(result, true))
		return nil
	}

	merged := generate.GeneratePreview{
		Writes:    writes,
		Unchanged: envPreview.Unchanged,
		Refused:   envPreview.Refused,
	}
	if err := generate.ApplyPreview(root, merged); err != nil {
		return err
	}
	result["applied"] = true
	EmitResult(io, flags.Mode, result, prettyGenerate(result, false))
	return nil
}

func prettyGenerate(result map[string]any, dryRun bool) string {
	written, _ := result["written"].([]string)
	unchanged, _ := result["unchanged"].([]string)
	refused, _ := result["refused"].([]string)
	warnings, _ := result["warnings"].([]core.PlanIssue)

	verb := "wrote"
	sym := "+"
	if dryRun {
		verb = "would write"
		sym = "~"
	}
	var lines []string
	lines = append(lines, fmt.Sprintf("%s: %d · unchanged: %d · refused: %d", verb, len(written), len(unchanged), len(refused)))
	for _, p := range written {
		lines = append(lines, "  "+sym+" "+p)
	}
	for _, p := range refused {
		lines = append(lines, "  ! "+p+" (exists without the menv marker — left as is)")
	}
	for _, w := range warnings {
		lines = append(lines, "  ⚠ "+w.Code+": "+w.Message)
	}
	return strings.Join(lines, "\n")
}

func runImport(root string, reg registry.Registry, file, consumer, vaultName string, flags MutationFlags, io Io, newKey func() string, promptFn PromptFn) error {
	absFile := filepath.Join(root, file)
	data, err := os.ReadFile(absFile)
	if os.IsNotExist(err) {
		return &core.MenvError{Code: core.ErrNotFound, Message: "no such file: " + file}
	}
	if err != nil {
		return err
	}
	entries := menvio.ParseDotenv(string(data))
	sess, err := OpenVaultSession(root, reg, vaultName, flags, promptFn)
	if err != nil {
		return err
	}

	// Collect current values for already-wired keys (for conflict detection).
	currentValues := map[string]string{}
	for _, e := range entries {
		entry, ok := reg.Variables[e.Key]
		if !ok {
			continue
		}
		mapping, ok := entry.VaultMapping[vaultName]
		if !ok {
			continue
		}
		me, ok := mapping[consumer]
		if !ok {
			continue
		}
		val, found, verr := sess.Get(me.Key)
		if verr != nil {
			return verr
		}
		if found {
			currentValues[me.Key] = val
		}
	}

	// Convert DotenvEntry slices.
	importEntries := make([]ops.DotenvEntry, len(entries))
	for i, e := range entries {
		importEntries[i] = ops.DotenvEntry{Key: e.Key, Value: e.Value}
	}

	op, report, err := ops.PlanImportEntries(reg, ops.ImportInput{
		Entries:       importEntries,
		Consumer:      consumer,
		Vault:         vaultName,
		CurrentValues: currentValues,
		Force:         flags.Force,
		NewKey:        newKey,
	})
	if err != nil {
		return err
	}
	sessions := map[string]core.VaultSession{vaultName: sess}
	return RunMutation(root, reg, op, flags, io, sessions, MutationExtras{
		ResultFields: map[string]any{"report": report},
		Pretty:       formatImportReport(report),
	}, promptFn)
}

func formatImportReport(r ops.ImportReport) string {
	sort.Strings(r.Defined)
	sort.Strings(r.Wired)
	sort.Strings(r.Updated)
	lines := []string{
		"defined: " + noneOrList(r.Defined),
		"wired:   " + noneOrList(r.Wired),
		"updated: " + noneOrList(r.Updated),
	}
	for _, s := range r.Skipped {
		lines = append(lines, "skipped: "+s.Key+" ("+s.Reason+")")
	}
	return strings.Join(lines, "\n")
}

func noneOrList(ss []string) string {
	if len(ss) == 0 {
		return "none"
	}
	return strings.Join(ss, ", ")
}

func runBackup(root string, reg registry.Registry, flags MutationFlags, io Io) error {
	key := menvio.BackupKey(time.Now())

	// Collect vault filenames for menv-local vaults.
	var vaultFiles []string
	for _, def := range reg.Vaults {
		if def.VaultType != "menv-local" {
			continue
		}
		var cfg struct {
			Filename string `json:"filename"`
		}
		if json.Unmarshal(def.VaultConfig, &cfg) == nil && cfg.Filename != "" {
			vaultFiles = append(vaultFiles, cfg.Filename)
		}
	}
	sort.Strings(vaultFiles)

	// Candidates: all consumer-generated paths + .env.compose siblings.
	candidateSet := map[string]bool{}
	for _, def := range reg.Consumers {
		cp := generate.ConsumerPathsFor(def)
		for _, p := range cp.Main {
			candidateSet[p] = true
		}
		for _, p := range cp.Local {
			candidateSet[p] = true
		}
		if cp.Example != "" {
			candidateSet[cp.Example] = true
		}
	}
	seenDirs := map[string]bool{}
	for _, cfile := range reg.Compose.Files {
		dir := filepath.Dir(cfile)
		if dir == "." {
			dir = ""
		}
		if seenDirs[dir] {
			continue
		}
		seenDirs[dir] = true
		var envCompose string
		if dir == "" {
			envCompose = ".env.compose"
		} else {
			envCompose = filepath.Join(dir, ".env.compose")
		}
		candidateSet[envCompose] = true
	}
	candidates := make([]string, 0, len(candidateSet))
	for c := range candidateSet {
		candidates = append(candidates, c)
	}
	sort.Strings(candidates)

	paths, err := menvio.CollectBackupPaths(root, registry.RegistryFilename, vaultFiles, candidates, generate.HasOwnershipMarker)
	if err != nil {
		return err
	}
	rel, err := menvio.CreateBackup(root, key, paths)
	if err != nil {
		return err
	}
	EmitResult(io, flags.Mode, map[string]any{"key": key, "files": paths},
		fmt.Sprintf("Backup saved in %s (%d files)", rel, len(paths)))
	return nil
}

func runRestore(root, key string, flags MutationFlags, io Io) error {
	keys, err := menvio.ListBackups(root)
	if err != nil {
		return err
	}
	if len(keys) == 0 {
		return &core.MenvError{Code: core.ErrNotFound, Message: "no backups found"}
	}
	if key == "" {
		if !IsTTY() {
			return &core.MenvError{Code: core.ErrValidation, Message: "restore needs a backup key (no TTY to pick one)"}
		}
		key = pickBackup(keys)
	}
	found := false
	for _, k := range keys {
		if k == key {
			found = true
			break
		}
	}
	if !found {
		return &core.MenvError{Code: core.ErrNotFound, Message: fmt.Sprintf("unknown backup %q (have: %s)", key, strings.Join(keys, ", "))}
	}
	if !flags.Force {
		if !IsTTY() {
			return &core.MenvError{Code: core.ErrValidation, Message: "restore overwrites files — pass --force to proceed without a TTY"}
		}
		if !confirmRestore(key) {
			EmitResult(io, flags.Mode, map[string]any{"restored": []string{}}, "aborted")
			return nil
		}
	}
	restored, err := menvio.RestoreBackup(root, key)
	if err != nil {
		return err
	}
	EmitResult(io, flags.Mode, map[string]any{"key": key, "restored": restored},
		fmt.Sprintf("restored %d files from %s", len(restored), key))
	return nil
}

func pickBackup(keys []string) string {
	for i, k := range keys {
		fmt.Fprintf(os.Stderr, "  %d) %s\n", i+1, k)
	}
	fmt.Fprint(os.Stderr, "restore which? (number or key): ")
	var ans string
	fmt.Scanln(&ans)
	for i, k := range keys {
		if ans == fmt.Sprintf("%d", i+1) {
			return k
		}
	}
	return ans
}

func confirmRestore(key string) bool {
	fmt.Fprintf(os.Stderr, "overwrite files from %q? [y/N]: ", key)
	var ans string
	fmt.Scanln(&ans)
	return strings.ToLower(ans) == "y"
}

// ── helpers ───────────────────────────────────────────────────────────────

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedStringSet(s map[string]bool) []string {
	keys := make([]string, 0, len(s))
	for k := range s {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func coalesce(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func vaultsWiringConsumer(reg registry.Registry, consumer string) []string {
	seen := map[string]bool{}
	for _, def := range reg.Variables {
		for v, byConsumer := range def.VaultMapping {
			if _, ok := byConsumer[consumer]; ok {
				seen[v] = true
			}
		}
	}
	return sortedStringSet(seen)
}

// errors package is needed by vault check.
var _ = errors.New
