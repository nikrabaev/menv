package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/google/uuid"
	"github.com/nikrabaev/menv/go/internal/cli"
	"github.com/nikrabaev/menv/go/internal/core"
	menvio "github.com/nikrabaev/menv/go/internal/io"
	"github.com/nikrabaev/menv/go/internal/registry"
	"github.com/nikrabaev/menv/go/internal/tui"
	_ "github.com/nikrabaev/menv/go/internal/vault/local" // register menv-local provider
	"github.com/spf13/cobra"
)

var version = "dev"

func main() {
	mode := cli.PeekJSONMode(os.Args[1:])
	ioCtx := cli.ProcessIo()

	cwd, _ := os.Getwd()
	root, ok := menvio.FindRoot(cwd)
	if !ok {
		root = cwd
	}

	program := cli.BuildProgram(root, ioCtx, func() string { return uuid.New().String() })
	program.Version = version

	// tui command lives here to avoid import cycle (cli → tui → cli).
	program.AddCommand(&cobra.Command{
		Use:   "tui",
		Short: "interactive terminal UI",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := &tui.TuiContext{
				Root: root,
				Env:  osEnv(),
				Auth: map[string]string{},
			}
			// A missing registry is not fatal here — the TUI shows an init
			// wizard instead. Any other load error (corrupt/invalid) is fatal.
			reg, err := registry.LoadRegistry(root)
			loaded := err == nil
			if err != nil {
				var me *core.MenvError
				if !errors.As(err, &me) || me.Code != core.ErrNotFound {
					return err
				}
			}
			m := tui.NewAppModel(ctx, reg, loaded)
			// Alt screen is requested declaratively via the View in v2.
			p := tea.NewProgram(m)
			_, err = p.Run()
			return err
		},
	})

	if err := program.Execute(); err != nil {
		var me *core.MenvError
		if errors.As(err, &me) {
			cli.EmitError(ioCtx, mode, me)
			os.Exit(me.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "menv: %v\n", err)
		os.Exit(2)
	}
}

func osEnv() map[string]string {
	env := make(map[string]string)
	for _, kv := range os.Environ() {
		if i := strings.Index(kv, "="); i >= 0 {
			env[kv[:i]] = kv[i+1:]
		}
	}
	return env
}
