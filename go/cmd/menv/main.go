package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/nikrabaev/menv/internal/cli"
	"github.com/nikrabaev/menv/internal/core"
	menvio "github.com/nikrabaev/menv/internal/io"
	_ "github.com/nikrabaev/menv/internal/vault/local" // register menv-local provider
)

var version = "dev"

func main() {
	mode := cli.PeekJSONMode(os.Args[1:])
	io := cli.ProcessIo()

	cwd, _ := os.Getwd()
	root, ok := menvio.FindRoot(cwd)
	if !ok {
		root = cwd
	}

	program := cli.BuildProgram(root, io, func() string { return uuid.New().String() })
	program.Version = version

	if err := program.Execute(); err != nil {
		var me *core.MenvError
		if errors.As(err, &me) {
			cli.EmitError(io, mode, me)
			os.Exit(me.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "menv: %v\n", err)
		os.Exit(2)
	}
}
