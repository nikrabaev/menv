# Quit Confirmation on Unsaved Changes

**Date:** 2026-05-31

## Goal

When the user tries to exit (via `q` or Ctrl+C) with unsaved changes, intercept and ask whether to save before quitting. A clean exit skips the prompt entirely.

## Mode change

Add `"quit"` to the `Mode` union in `app.tsx`:

```ts
type Mode = "browse" | "edit" | "new" | "wire" | "filter" | "quit";
```

## Trigger keys

In the `useInput` handler (browse mode), both `q` and Ctrl+C (`key.ctrl && input === "c"`) check `dirty`:

- If `dirty === false` → call `exit()` immediately (no change from current behaviour).
- If `dirty === true` → `setMode("quit")`.

The Ink `render()` call in `launchTui` gains `exitOnCtrlC: false` so the process does not receive SIGINT before the modal can appear.

## Confirmation modal

Rendered in the same bottom slot used by the filter box. `bottomHeight = 3`.

```
╭──────────────────────────────────────────────╮
│ Save changes before exiting? [Y/n]            │
╰──────────────────────────────────────────────╯
```

Key bindings while `mode === "quit"`:

| Key | Action |
|-----|--------|
| Enter or `y` | Save (calls `saveModel`, then `exit()`) |
| `n` or Ctrl+C | Discard & `exit()` immediately |
| Escape | Cancel — return to `"browse"` |

## Layout

`bottomHeight` for `"quit"` mode is `3` (border top + one content line + border bottom), identical to `"filter"` mode. The existing layout budget `topBar(3) + paneHeight + bottomHeight = rows` is preserved.

## Scope

- All changes are in `src/ui/app.tsx` — no new files.
- The modal is inlined like the filter box (not extracted to a component).
- No changes to `saveModel`, `Store`, or any other module.

## Error handling

If `saveModel` throws while the user chose to save, the error is surfaced as a status message and the app returns to `"browse"` mode (does not force-exit). This mirrors the existing pattern for the `s` save shortcut.
