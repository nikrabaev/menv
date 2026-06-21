package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/google/uuid"
	"github.com/nikrabaev/menv/internal/cli"
	"github.com/nikrabaev/menv/internal/core"
	menvio "github.com/nikrabaev/menv/internal/io"
	"github.com/nikrabaev/menv/internal/registry"
	"github.com/nikrabaev/menv/internal/tui"
	_ "github.com/nikrabaev/menv/internal/vault/local" // register menv-local provider
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
			reg, err := registry.LoadRegistry(root)
			if err != nil {
				return err
			}
			ctx := &tui.TuiContext{
				Root: root,
				Env:  osEnv(),
				Auth: map[string]string{},
			}
			m := tui.NewAppModel(ctx, reg)
			p := tea.NewProgram(m, tea.WithAltScreen())
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
