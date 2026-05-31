export const HELP_TEXT = `menv — manage environment variables across a monorepo

Usage:
  menv [command] [options]

Commands:
  (none)                  Launch the interactive TUI (default)
  init [options]          Scan the repo, set up the vault, update .gitignore
                            --backend <kind>  Key storage: keychain | 1password
                                              | password (omit to pick
                                              interactively)
                            --vault <name>    1Password vault for the new item
                                              (default: Private)
  generate [--env <env>]  Regenerate .env files from the vault (headless/CI).
                          The password backend reads MENV_PASSPHRASE.
  backup                  Back up every .env and .env.example file into
                          .menv/backups/<timestamp>
  restore [key] [-f]      Restore .env/.env.example files from a backup
                            key          Restore a specific backup by its
                                         timestamp key. Omit it to pick one
                                         interactively (↑/↓ to move, Enter to
                                         confirm).
                            -f, --force  With a key, overwrite every file without
                                         prompting.

  When a restored file already exists you are asked, per file:
    y  yes          Y  yes to all
    n  no           N  no to all

Options:
  -h, --help     Show this help
  -v, --version  Show the version
`;
