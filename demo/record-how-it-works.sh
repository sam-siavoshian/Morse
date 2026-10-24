#!/usr/bin/env bash
# A real, unedited recording of Morse changing a real app, with a live trace of
# every step beside it: VSCodium on the left, `MORSE_TRACE` on the right.
# Real X key presses and clicks (xdotool), real Claude Code (sonnet).
#
#   demo/record-how-it-works.sh [out.mp4]
#
# Needs: Xvfb, xdotool, xterm, ffmpeg, codium, and `claude` signed in.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-docs/launch/how-it-works.mp4}
D=:95
WORK=$(mktemp -d /tmp/morse-hiw-XXXX)
TRACE=$WORK/trace.log
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$WORK"' EXIT

Xvfb $D -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
sleep 1
export DISPLAY=$D

cat > "$TRACE" <<EOF
  MORSE · live trace (MORSE_TRACE=1)
  every step of a change, as it happens

EOF
LANG=C.UTF-8 LC_ALL=C.UTF-8 xterm -u8 -geometry 80x90+1282+0 -bg '#0d0d0d' -fg '#d6d6d6' -fa 'DejaVu Sans Mono' -fs 8 -bw 0 \
  -T 'morse trace' -e tail -n +1 -f "$TRACE" &
sleep 1

ffmpeg -loglevel error -y -f x11grab -framerate 15 -video_size 1920x1080 -i $D \
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
  -- --no-sandbox --user-data-dir="$WORK/codium" || true

sleep 2
kill -INT $FF; wait $FF 2>/dev/null || true
mkdir -p "$(dirname "$OUT")"
cp "$WORK/raw.mp4" "$OUT"
cp "$TRACE" "${OUT%.mp4}-trace.log"
echo "wrote $OUT"
