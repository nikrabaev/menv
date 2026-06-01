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

  define NAME [options]   Create or update a variable's definition and wiring
                            --secret | --no-secret  Mark/unmark as a secret
                            --description <text>     Set the description
                            --example <text>         Set the .env.example placeholder
                            --group <name>           Set the group ("" clears it)
                            --scope <c1,c2,...>      Replace its wiring; use "root"
                                                     for the repo-root .env target
  set NAME [value]        Set a value (value from arg, stdin, or hidden prompt)
                            --env <env>       Target environment (default: default)
                            --scope <c>       Disambiguate a repeated name
  get NAME [options]      Print a value to stdout (raw; secrets included)
                            --env <env>, --scope <c>
  list [options]          List variables (secrets shown as ***)
                            --scope <c>, --group <name>, --env <env>, --json
  wire NAME <c1,c2,...>   Wire a variable to consumers (apps and/or "root")
  unwire NAME <c1,c2,...> Unwire a variable from consumers
  rm NAME [--scope <c>]   Delete a variable
  mode <consumer> <m>     Set a consumer's .env file layout: single (one .env) or
                          perenv (one .env.<env> per environment)

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
