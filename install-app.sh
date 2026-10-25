#!/bin/sh
# The Morse app for macOS and Linux, in one line in Terminal:
#
#   curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install-app.sh | sh
#
# Why a line and not only the .dmg: Morse isn't notarized by Apple (that takes
# a paid Apple Developer ID), so a .dmg downloaded in a browser gets macOS's
# "can't be checked" warning and a trip to Privacy & Security. A file curl
# downloads isn't marked as downloaded from the internet, so the app this puts
# in Applications opens like any other. It's checked against the release's
# SHA256SUMS first. Morse updates itself the same way after that
# (desktop-app/updater.js).
#
# What it does, and nothing else:
#   1. downloads the app for this computer from the "preview" release on GitHub
#   2. checks it against the release's SHA256SUMS (nothing is installed if it
#      doesn't match)
#   3. macOS: quits Morse if it's open and puts Morse.app in /Applications (or
#      ~/Applications when /Applications isn't yours to write)
#      Linux: puts the AppImage in ~/.local/share/morse and makes it runnable
#   4. opens Morse
#
# Remove it: drag Morse to the Trash (macOS), or delete ~/.local/share/morse
# (Linux). Your mods stay in ~/.morse.
#
# Settings (for testing, or a mirror): MORSE_INSTALL_BASE (where the release
# files are), MORSE_APPS_DIR (where Morse.app goes), MORSE_NO_OPEN=1 (don't
# open it).

set -eu

REPO="sam-siavoshian/RRAA"
BASE="${MORSE_INSTALL_BASE:-https://github.com/$REPO/releases/download/preview}"
TMP=""

say() { printf '%s\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
cleanup() { [ -n "$TMP" ] && rm -rf "$TMP"; return 0; }

download() {
  case "$1" in
    https://*) curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 -o "$2" "$1" ;;
    http://127.0.0.1[:/]*|http://localhost[:/]*) curl -fsSL --retry 2 -o "$2" "$1" ;; # tests
    *) fail "Won't download from $1: only https addresses." ;;
  esac
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d ' ' -f 1
  else sha256sum "$1" | cut -d ' ' -f 1; fi
}

main() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os/$arch" in
    Darwin/arm64) file="Morse-mac-arm64.zip" ;;
    Darwin/x86_64) file="Morse-mac-x64.zip" ;;
    Linux/x86_64) file="Morse-linux-x86_64.AppImage" ;;
    Darwin/*) fail "Morse doesn't have a build for this Mac ($arch) yet." ;;
    Linux/*) fail "Morse's app is built for 64-bit Intel and AMD Linux only, not $arch. The terminal version works everywhere: https://github.com/$REPO#install" ;;
    *) fail "This line is for macOS and Linux. On Windows, download Morse-Setup.exe: https://github.com/$REPO/releases/tag/preview" ;;
  esac
  command -v curl >/dev/null 2>&1 || fail "This needs curl, which isn't on this computer."

  TMP=$(mktemp -d 2>/dev/null || mktemp -d -t morse)
  trap cleanup EXIT INT TERM

  say "Morse"
  say "  Downloading $file…"
  rc=0; download "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || rc=$?
  [ "$rc" -eq 0 ] || fail "Couldn't reach GitHub (curl said $rc). Check your internet connection and run the same line again."
  rc=0; download "$BASE/$file" "$TMP/$file" || rc=$?
  [ "$rc" -eq 0 ] || fail "Couldn't download $file (curl said $rc). Run the same line again in a minute."
  want=$(sed -n "s/^\([0-9a-fA-F]\{64\}\)[ *][ *]*$(printf '%s' "$file" | sed 's/\./\\./g')\$/\1/p" "$TMP/SHA256SUMS" | head -n 1 | tr 'A-F' 'a-f')
  [ -n "$want" ] || fail "The release's SHA256SUMS has no line for $file, so the download can't be checked. Nothing was installed."
  got=$(sha256_of "$TMP/$file")
  [ "$got" = "$want" ] || fail "The download doesn't match its checksum, so it wasn't installed. Run the same line again; if it still fails, tell us: https://github.com/$REPO/issues"
  say "  ✓ Checked against the release's SHA256SUMS."

  if [ "$os" = Darwin ]; then
    ditto -x -k "$TMP/$file" "$TMP/app"
    new=""
    for a in "$TMP"/app/*.app; do [ -d "$a" ] && new="$a"; done
    [ -n "$new" ] || fail "The download has no app in it. Nothing was installed."
    apps="${MORSE_APPS_DIR:-/Applications}"
    if [ -z "${MORSE_APPS_DIR:-}" ] && ! [ -w "$apps" ]; then apps="$HOME/Applications"; fi
    mkdir -p "$apps"
    dest="$apps/Morse.app"
    if pgrep -f "$dest/Contents/MacOS/" >/dev/null 2>&1; then
      say "  Quitting Morse to put the new one in…"
      osascript -e 'tell application id "dev.morse.desktop" to quit' >/dev/null 2>&1 || osascript -e 'tell application "Morse" to quit' >/dev/null 2>&1 || true
      i=0; while pgrep -f "$dest/Contents/MacOS/" >/dev/null 2>&1 && [ $i -lt 50 ]; do sleep 0.2; i=$((i + 1)); done
    fi
    rm -rf "$dest.old"
    [ -e "$dest" ] && mv "$dest" "$dest.old"
    if mv "$new" "$dest"; then rm -rf "$dest.old"; else [ -e "$dest.old" ] && mv "$dest.old" "$dest"; fail "Couldn't put Morse in $apps."; fi
    say "  ✓ Morse is in $apps."
    [ "${MORSE_NO_OPEN:-}" = 1 ] || open "$dest"
  else
    dir="${MORSE_APPS_DIR:-$HOME/.local/share/morse}"
    mkdir -p "$dir"
    dest="$dir/Morse.AppImage"
    mv -f "$TMP/$file" "$dest.new" && chmod +x "$dest.new" && mv -f "$dest.new" "$dest"
    say "  ✓ Morse is at $dest. It adds itself to your apps menu when it opens."
    [ "${MORSE_NO_OPEN:-}" = 1 ] || { nohup "$dest" >/dev/null 2>&1 & }
  fi
  say ""
  say "Morse is open. It updates itself from now on."
}

main "$@"
