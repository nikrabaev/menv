#!/usr/bin/env bash
# Regenerates assets/tui.gif — a VHS recording of `menv tui` driven against a
# throwaway, deterministic demo repo. Self-contained and path-portable: it
# derives the repo root from its own location and builds the demo in a fresh
# temp dir, so it reruns on any checkout.
#
#   bun run demo:gif        # or: bash scripts/capture-tui-demo.sh
#
# Requires: vhs, ttyd, ffmpeg (vhs deps), gifsicle (lossless optimize), bun.
#   brew install vhs ttyd gifsicle
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)/menv-tui-demo"
TAPE="$WORK/tui.tape"
RAW="$WORK/raw.gif"
OUT="$REPO/assets/tui.gif"
MENV="bun run $REPO/src/index.ts"

for t in vhs gifsicle bun; do
  command -v "$t" >/dev/null || { echo "missing required tool: $t" >&2; exit 1; }
done

# --- build a realistic demo repo (plaintext vault ⇒ no passphrase modal) ---
mkdir -p "$WORK"
cd "$WORK"
$MENV init --no-encrypt >/dev/null

$MENV consumer add api    --strategy single --base-dir apps/api    --filename .env >/dev/null
$MENV consumer add web    --strategy single --base-dir apps/web    --filename .env >/dev/null
$MENV consumer add worker --strategy single --base-dir apps/worker --filename .env >/dev/null

$MENV group add database      --title "Database"        >/dev/null
$MENV group add auth          --title "Auth & Security" >/dev/null
$MENV group add payments      --title "Payments"        >/dev/null
$MENV group add observability --title "Observability"   >/dev/null

dws() { # name group secret|plain consumers value
  if [ "$3" = "secret" ]; then $MENV var define "$1" --group "$2" --secret >/dev/null
  else $MENV var define "$1" --group "$2" >/dev/null; fi
  $MENV wire "$1" --vault local --consumers "$4" --shared >/dev/null
  printf '%s' "$5" | $MENV set "$1" --vault local >/dev/null
}

dws DATABASE_URL          database      secret api,worker     "postgres://app@db.internal:5432/app"
dws REDIS_URL             database      plain  api,worker     "redis://cache.internal:6379/0"
dws JWT_SECRET            auth          secret api            "sk_jwt_8f2b1c9d4e"
dws SESSION_SECRET        auth          secret api,web        "sess_2a9f7e1b"
dws STRIPE_SECRET_KEY     payments      secret api,worker     "sk_live_51MxQ2"
dws STRIPE_WEBHOOK_SECRET payments      secret api            "whsec_3bXk9"
dws SENTRY_DSN            observability plain  api,web,worker "https://abc@o12.ingest.sentry.io/456"
dws LOG_LEVEL            observability plain  api,web,worker "info"

$MENV global define NODE_ENV --vault local --value production >/dev/null
$MENV global define PORT     --vault local --runtime          >/dev/null

# --- menv wrapper so the recording shows a clean `menv tui` on PATH ---
mkdir -p "$WORK/bin"
cat > "$WORK/bin/menv" <<EOF
#!/usr/bin/env bash
exec bun run "$REPO/src/index.ts" "\$@"
EOF
chmod +x "$WORK/bin/menv"

# --- the screenplay ---
cat > "$TAPE" <<EOF
# menv TUI demo — keyboard-first control over the whole environment.
Output "$RAW"

Set Shell "bash"
Set FontSize 16
Set Width 1360
Set Height 540
Set Padding 18
Set Theme "Catppuccin Mocha"
Set CursorBlink false
Set TypingSpeed 55ms

# --- setup (hidden from the recording) ---
Hide
Type "export PATH=$WORK/bin:\$PATH"
Enter
Type "cd $WORK"
Enter
Type "clear"
Enter
Show

# --- scene ---
Type "menv tui"
Enter
Sleep 3.5s

# walk the variable list — the inspector's wiring matrix updates live
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 700ms
Type "j"
Sleep 900ms

# the main list is tabbed: variables -> globals (static/runtime) -> groups
Type "]"
Sleep 1.6s
Type "]"
Sleep 1s

# back to variables
Type "["
Sleep 300ms
Type "["
Sleep 900ms

# every mutation shows its plan first — open the generate plan
Type "g"
Sleep 3s
Escape
Sleep 1s
EOF

# --- render + lossless optimize ---
echo "rendering $TAPE ..."
vhs "$TAPE"
echo "optimizing -> $OUT"
gifsicle -O3 "$RAW" -o "$OUT"
echo "done: $OUT ($(du -h "$OUT" | cut -f1))"
