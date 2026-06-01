#!/usr/bin/env bash
# Rasterize an SVG terminal screenshot to a 2x PNG with headless Chrome.
# Chrome is used because vhs / ImageMagick / rsvg-convert are not installed here,
# but a browser engine is the most faithful SVG renderer anyway (correct font
# metrics, drop-shadow filter, transparency).
#
# Usage: rasterize.sh <in.html> <out.png> [width height]
# If width/height are omitted they're read from the sibling .svg's root element.
set -euo pipefail

HTML="${1:?usage: rasterize.sh <in.html> <out.png> [W H]}"
OUT="${2:?usage: rasterize.sh <in.html> <out.png> [W H]}"
W="${3:-}"
H="${4:-}"

# Locate a Chromium-family browser.
CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "$(command -v google-chrome 2>/dev/null || true)" \
  "$(command -v chromium 2>/dev/null || true)" \
  "$(command -v chromium-browser 2>/dev/null || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then CHROME="$c"; break; fi
done
if [ -z "$CHROME" ]; then
  echo "rasterize: no Chrome/Chromium/Edge found — install one, or open the SVG manually" >&2
  exit 1
fi

# Derive window size from the SVG if not given.
if [ -z "$W" ] || [ -z "$H" ]; then
  SVG="${HTML%.html}.svg"
  if [ -f "$SVG" ]; then
    W="$(grep -oE 'width="[0-9]+"' "$SVG" | head -1 | grep -oE '[0-9]+')"
    H="$(grep -oE 'height="[0-9]+"' "$SVG" | head -1 | grep -oE '[0-9]+')"
  fi
fi
: "${W:?could not determine width — pass it explicitly}"
: "${H:?could not determine height — pass it explicitly}"

rm -f "$OUT"
"$CHROME" --headless --disable-gpu --no-sandbox \
  --force-device-scale-factor=2 \
  --default-background-color=00000000 \
  --hide-scrollbars \
  --window-size="${W},${H}" \
  --screenshot="$OUT" \
  "$HTML" >/dev/null 2>&1

if [ ! -s "$OUT" ]; then
  echo "rasterize: Chrome produced no output" >&2
  exit 1
fi
echo "wrote $OUT ($(file -b "$OUT"))"
