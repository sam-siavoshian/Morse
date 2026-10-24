#!/usr/bin/env bash
# A real, unedited recording of Morse changing a real app, with a live trace of
# every step beside it: VSCodium on the left, `MORSE_TRACE` on the right.
# Real X key presses and clicks (xdotool), real Claude Code (sonnet).
#
#   demo/record-how-it-works.sh [out.mp4]
#
# Needs: Xvfb, xauth, xdotool, xterm, ffmpeg, codium, and `claude` signed in.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-docs/launch/how-it-works.mp4}
WORK=$(mktemp -d /tmp/morse-hiw-XXXX)
TRACE=$WORK/trace.log
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$WORK"' EXIT

# Its own X display, that only this script can open. Without a key (-auth),
# any program on this computer could watch the screen and type into VSCodium,
# which has a terminal. And a display someone else already runs would make
# Xvfb fail, and the rest record and type into that one instead.
n=95
while [ -e "/tmp/.X11-unix/X$n" ] || [ -e "/tmp/.X$n-lock" ]; do n=$((n + 1)); done
D=":$n"
export XAUTHORITY=$WORK/Xauthority
touch "$XAUTHORITY"
xauth -q -f "$XAUTHORITY" add "$D" . "$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
Xvfb "$D" -screen 0 1920x1080x24 -nolisten tcp -auth "$XAUTHORITY" >/dev/null 2>&1 &
XVFB=$!
sleep 1
kill -0 "$XVFB" 2>/dev/null || { echo "Xvfb didn't start on $D" >&2; exit 1; }
export DISPLAY=$D
# Electron only refuses to start without --no-sandbox as root.
NO_SANDBOX=""
if [ "$(id -u)" = 0 ]; then NO_SANDBOX=--no-sandbox; fi

cat > "$TRACE" <<EOF
  MORSE · live trace (MORSE_TRACE=1)
  every step of a change, as it happens

EOF
LANG=C.UTF-8 LC_ALL=C.UTF-8 xterm -u8 -geometry 80x90+1282+0 -bg '#0d0d0d' -fg '#d6d6d6' -fa 'DejaVu Sans Mono' -fs 8 -bw 0 \
  -T 'morse trace' -e tail -n +1 -f "$TRACE" &
sleep 1

ffmpeg -loglevel error -y -f x11grab -framerate 15 -video_size 1920x1080 -i "$D" \
  -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p "$WORK/raw.mp4" &
FF=$!

# Keep the app on the left two-thirds of the screen whenever it opens.
( while sleep 0.5; do
    for w in $(xdotool search --name 'VSCodium' 2>/dev/null); do
      xdotool windowmove "$w" 0 0 windowsize "$w" 1280 1080 2>/dev/null || true
    done
  done ) &

MORSE_TRACE=$TRACE MORSE_PROVIDER=claude-code MORSE_MODEL=sonnet \
  node demo/try-real-app.js --app codium --window 'workbench\.html' --point '.statusbar' \
  --ask 'add a big live clock to the status bar' \
  --check '/\d{1,2}:\d{2}/.test(document.querySelector(".statusbar")?.innerText || "")' \
  -- $NO_SANDBOX --user-data-dir="$WORK/codium" || true

sleep 2
kill -INT $FF; wait $FF 2>/dev/null || true
mkdir -p "$(dirname "$OUT")"
cp "$WORK/raw.mp4" "$OUT"
cp "$TRACE" "${OUT%.mp4}-trace.log"
echo "wrote $OUT"
