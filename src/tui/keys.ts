// The single source of keybinding truth: the footer hint bar and the `?` help
// overlay are both derived from this table, so they can never drift from the
// handlers (which switch on the same context names).

export interface KeyHint {
  key: string;
  label: string;
}

export type KeyContext =
  | "global"
  | "sidebar-vault"
  | "sidebar-consumer"
  | "variables"
  | "variables-human"
  | "variables-rows"
  | "globals"
  | "groups"
  | "compose"
  | "backups"
  | "inspector"
  | "modal";

export const KEYMAP: Record<KeyContext, KeyHint[]> = {
  global: [
    { key: "tab/1-3", label: "panes" },
    { key: "[ ]", label: "tabs" },
    { key: "/", label: "filter" },
    { key: "g", label: "generate" },
    { key: "c", label: "check" },
    { key: "i", label: "import" },
    { key: "R", label: "reload" },
    { key: "H", label: "human mode" },
    { key: "^r", label: "reveal secrets" },
    { key: "?", label: "help" },
    { key: "q", label: "quit" },
  ],
  "sidebar-vault": [
    { key: "⏎", label: "make active" },
    { key: "u", label: "unlock" },
    { key: "a", label: "add" },
    { key: "e", label: "edit" },
    { key: "D", label: "set default" },
    { key: "x", label: "remove" },
  ],
  "sidebar-consumer": [
    { key: "⏎", label: "filter to" },
    { key: "a", label: "add" },
    { key: "e", label: "edit" },
    { key: "x", label: "remove" },
  ],
  variables: [
    { key: "⏎", label: "inspect" },
    { key: "n", label: "new" },
    { key: "e", label: "edit" },
    { key: "w", label: "wire" },
    { key: "u", label: "unwire" },
    { key: "s", label: "set value" },
    { key: "r", label: "reveal" },
    { key: "d", label: "en/disable" },
    { key: "x", label: "remove" },
  ],
  "variables-human": [
    { key: "⏎", label: "open table" },
    { key: "n", label: "new" },
    { key: "e", label: "edit" },
    { key: "w", label: "wire" },
    { key: "u", label: "unwire" },
    { key: "x", label: "remove" },
  ],
  "variables-rows": [
    { key: "j/k", label: "rows" },
    { key: "⏎", label: "edit value" },
    { key: "esc", label: "back" },
  ],
  globals: [
    { key: "n", label: "new" },
    { key: "e", label: "edit" },
    { key: "x", label: "remove" },
  ],
  groups: [
    { key: "n", label: "new" },
    { key: "e", label: "edit" },
    { key: "x", label: "remove" },
  ],
  compose: [
    { key: "n", label: "bind file" },
    { key: "x", label: "unbind" },
  ],
  backups: [
    { key: "n", label: "backup now" },
    { key: "⏎", label: "restore" },
  ],
  inspector: [
    { key: "j/k", label: "wiring rows" },
    { key: "s", label: "set value" },
    { key: "r", label: "reveal" },
    { key: "d", label: "en/disable" },
    { key: "u", label: "unwire" },
  ],
  modal: [
    { key: "⏎", label: "confirm" },
    { key: "esc", label: "cancel" },
  ],
};

// Hints for a context with runtime suppressions applied. While secrets are
// globally revealed, the per-value `r` peek is unavailable, so its hint is
// dropped from the contexts that offer it.
export function contextHints(context: KeyContext, revealSecrets = false): KeyHint[] {
  const hints = KEYMAP[context];
  if (revealSecrets && (context === "variables" || context === "inspector")) {
    return hints.filter((h) => h.key !== "r");
  }
  return hints;
}

// The 3–8 hints shown in the footer for a focused context (global tail kept short).
export function footerHints(context: KeyContext, revealSecrets = false): KeyHint[] {
  const own = contextHints(context, revealSecrets).slice(0, 6);
  return [...own, { key: "?", label: "help" }, { key: "q", label: "quit" }];
}

export const HELP_SECTIONS: { title: string; context: KeyContext }[] = [
  { title: "Global", context: "global" },
  { title: "Vaults (sidebar)", context: "sidebar-vault" },
  { title: "Consumers (sidebar)", context: "sidebar-consumer" },
  { title: "Variables", context: "variables" },
  { title: "Variables (human)", context: "variables-human" },
  { title: "Variables · row", context: "variables-rows" },
  { title: "Globals", context: "globals" },
  { title: "Groups", context: "groups" },
  { title: "Compose", context: "compose" },
  { title: "Backups", context: "backups" },
  { title: "Inspector", context: "inspector" },
  { title: "Modals", context: "modal" },
];
