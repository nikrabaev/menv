---
name: screenshot-tui
description: >-
  Capture a polished PNG screenshot of the menv Ink/React TUI for docs, the
  README, a PR, or an issue. Use this whenever someone wants an image, picture,
  screenshot, or preview of menv's interface — the three-pane scopes/variables/
  inspector layout, a modal (wire, edit, quit), grouped variables, or any TUI
  state — ESPECIALLY since this machine has no vhs, tmux, asciinema, or
  ImageMagick, so the naive "just screenshot the terminal" approaches all fail.
  Trigger on phrases like "screenshot the TUI", "add a picture of the app to the
  README", "show what menv looks like", or "grab an image of the wire modal".
---

# Screenshotting the menv TUI

## The problem this solves

menv is a full-screen Ink/React TUI. You can't screenshot it the obvious ways here:

- **No `vhs`, `tmux`, `asciinema`, `freeze`, or ImageMagick** are installed — the
  usual terminal-recording tools are all absent. Don't waste a turn rediscovering
  this; verify with `command -v vhs tmux magick` if you must, then move on.
- **The app needs a real TTY** and an alternate screen, so piping its stdout to a
  file just captures escape sequences, not a frame.

What *is* available: **Bun** (the project's runtime) and **headless Google Chrome**.
So instead of recording a terminal, we render the real component to a text frame,
draw that frame as an SVG terminal window, and rasterize the SVG with Chrome.

The result is the genuine `MenvApp` output — not a mock-up — turned into a crisp
2× PNG with a macOS-style window chrome.

## Pipeline

```
MenvApp (real component)
  └─ ink-testing-library, via `bun test`  ──►  frame.ansi   (one rendered frame)
       └─ scripts/ansi2svg.ts              ──►  shot.svg + shot.html
            └─ scripts/rasterize.sh (Chrome) ──►  shot.png   (2×, transparent margin)
```

Three steps, three bundled files. Work in a scratch dir like `/tmp/menv-shot/`.

## Step 1 — render the component to an ANSI frame

Copy the harness into the test tree and run it. It must live under `tests/ui/`
(not `/tmp`) and run under `bun test`, because Ink needs the project's single
React instance — a standalone `bun run` script pulls a second React copy and
renders an empty frame ("Invalid hook call").

```bash
mkdir -p /tmp/menv-shot
cp .claude/skills/screenshot-tui/references/render-harness.tsx tests/ui/_shot.test.tsx
FORCE_COLOR=1 bun test tests/ui/_shot.test.tsx   # writes /tmp/menv-shot/frame.ansi
```

`FORCE_COLOR=1` is the difference between a colored screenshot and a monochrome
one. ink-testing-library renders with no TTY, so Ink/chalk auto-disable colour and
the frame comes out with zero ANSI codes — `ansi2svg.ts` then has nothing to
colour. Forcing it makes Ink emit the basic 16-colour SGR codes (menv only uses
Ink's *named* colours — cyan, yellow, green, gray, inverse — so level 1 is enough;
`2`/`3` produce the same output). Those are exactly the codes the converter's
palette maps. Capture without it and you'll get a grey wall of text.

Open `references/render-harness.tsx` and edit the `// EDIT:` blocks first:

- **The demo model** — the sample apps and variables to show. The default set
  exercises grouping, global vs. local, wiring, secrets, and an unset value. Tailor
  it to whatever feature you're documenting.
- **Viewport** (`COLUMNS`/`ROWS`) — keep `COLUMNS` ≥ ~150. menv's panes are
  scopes(40) + variables(flex) + inspector(60); a narrower viewport clips the
  inspector. `ROWS` should exceed the variable count so nothing scrolls off.
- **To capture a modal** (wire/edit/quit) instead of the browse view, drive it with
  the harness's `stdin` before capturing — e.g. focus the inspector and press Enter
  on the wiring field. See `tests/ui/app.test.tsx` for the input-then-`await` idiom.

Sanity-check the frame before going on (strip ANSI to read it):

```bash
perl -pe 's/\e\[[0-9;]*m//g' /tmp/menv-shot/frame.ansi
```

You should see the three boxed panes with their borders closing. A blank or
2-line frame means the render didn't settle — re-run; the harness already waits
and picks the settled frame.

## Step 2 — ANSI frame → SVG

```bash
bun run .claude/skills/screenshot-tui/scripts/ansi2svg.ts \
  /tmp/menv-shot/frame.ansi /tmp/menv-shot/shot.svg \
  --title "menv — environment vault"
```

This maps Ink's ANSI colours to a Tokyo-Night palette, draws the window chrome
(title bar + traffic lights + drop shadow), and writes both `shot.svg` and
`shot.html`. It prints the pixel dimensions, which Step 3 reuses.

It also fixes a real artifact: **ink-testing-library doesn't pad a pane's rows out
to its box width**, so the rightmost pane's closing `│` would otherwise hug the
text mid-line instead of sitting at the edge. The converter re-pads each bordered
row so all panes' right borders align. (This is the same bleed-through the
project's CLAUDE.md warns about — it never appears in a real terminal.)

## Step 3 — SVG → PNG (headless Chrome)

```bash
bash .claude/skills/screenshot-tui/scripts/rasterize.sh \
  /tmp/menv-shot/shot.html /tmp/menv-shot/shot.png
```

`rasterize.sh` finds Chrome/Chromium/Edge, reads the SVG's dimensions, and
screenshots at `--force-device-scale-factor=2` with a transparent background.
Output is a sharp, retina-density PNG.

## Step 4 — verify, then install and clean up

**Always look at the PNG** with the Read tool before declaring success — judge it
like a user would. Confirm:

- it's not blank and the dimensions are sane (`file shot.png`);
- all three panes are visible and their borders close on the right (no stray `│`);
- secrets show as `***`, grouped variables have `[Group]` headers, the env tabs and
  footer hints are present;
- **it's in colour** — `menv` green, the active env tab cyan-on-inverse, `global`
  and group headers cyan, `***` yellow. A grey wall of text means Step 1 ran without
  `FORCE_COLOR`.

Then move it where it belongs (the README references `assets/screenshot.png`) and
**remove the temporary test** so it never runs in CI:

```bash
mkdir -p assets
cp /tmp/menv-shot/shot.png assets/screenshot.png
cp /tmp/menv-shot/shot.svg assets/screenshot.svg   # keep the editable source alongside
rm -f tests/ui/_shot.test.tsx
bun test                                            # confirm the suite is green again
```

## Gotchas, condensed

| Symptom | Cause | Fix |
|---|---|---|
| Empty / 2-line frame | second React copy under `bun run` | run via `bun test` from `tests/ui/`, as Step 1 |
| "Invalid hook call" warning | same | same — never `bun run` the harness |
| Inspector pane clipped on the right | `COLUMNS` too small | widen to ≥ 150 |
| Stray `│` mid-line in a pane | ink-testing-library row padding | handled by ansi2svg.ts — make sure you ran it on the frame |
| Torn/overlapping rows | captured an unsettled frame | the harness waits 500ms and picks a full-height frame; re-run |
| Monochrome / grey screenshot | captured without `FORCE_COLOR` | re-run Step 1 with `FORCE_COLOR=1` — no TTY means Ink emits no colour otherwise |
| `rasterize: no Chrome found` | no Chromium-family browser | install Chrome, or open `shot.svg` in any browser and export |
| Colours look like raw VGA | a hue isn't in the palette map | add the SGR code to `PAL`/`BGPAL` in ansi2svg.ts |

## Files in this skill

- `scripts/ansi2svg.ts` — pure-Bun ANSI-frame → SVG + HTML converter (the palette,
  window chrome, and the row-padding fix live here).
- `scripts/rasterize.sh` — SVG/HTML → 2× PNG via headless Chrome.
- `references/render-harness.tsx` — the copy-edit-run-delete test that produces
  `frame.ansi` from the real `MenvApp`.
