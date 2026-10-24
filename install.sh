#!/bin/sh
# Morse for macOS and Linux, in one line:
#
#   curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install.sh | sh
#
# What it does, and nothing else:
#   1. checks that Node 22 or newer is here (it never installs system software;
#      it says how to get Node and stops)
#   2. downloads the small Morse package from the "preview" release on GitHub
#      and checks it against the release's SHA256SUMS (with no release yet, it
#      builds the package from the main branch instead, and says so)
#   3. puts Morse in ~/.morse/app, the Chrome extension in
#      ~/.morse/chrome-extension, and a `morse` command in ~/.local/bin (or
#      npm's own folder for commands, when that is on your PATH and yours)
#   4. runs `morse setup --auto`, which finds Claude Code or Codex
#   5. says what to do next
#
# Run it again to update. Remove Morse with `morse uninstall`, or:
#   curl -fsSL https://raw.githubusercontent.com/sam-siavoshian/RRAA/main/install.sh | sh -s -- --uninstall
#
# Options: --uninstall [--all]  remove what this added (--all: your mods and settings too)
#          --no-setup           skip `morse setup`
# Settings (for testing, or a mirror): MORSE_HOME (default ~/.morse),
# MORSE_BIN_DIR (where the morse command goes), MORSE_INSTALL_BASE (where the
# release files are), MORSE_INSTALL_SOURCE (the main branch's .tar.gz).
#
# Windows: install.ps1 does the same. docs/getting-started.md has every way in.

set -eu

REPO="sam-siavoshian/RRAA"
BASE="${MORSE_INSTALL_BASE:-https://github.com/$REPO/releases/download/preview}"
SOURCE="${MORSE_INSTALL_SOURCE:-https://codeload.github.com/$REPO/tar.gz/refs/heads/main}"
MORSE_DIR="${MORSE_HOME:-$HOME/.morse}"
APP="$MORSE_DIR/app"
EXT="$MORSE_DIR/chrome-extension"
RECEIPT="$MORSE_DIR/install.txt"
MARK="Morse: added by the install line"   # daemon/installed.js looks for it
PREVIEW_PAGE="https://github.com/$REPO/releases/tag/preview"

TMP=""
STAGE=""

say() { printf '%s\n' "$*"; }
step() { printf '  %s\n' "$*"; }
fail() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
cleanup() {
  [ -n "$TMP" ] && rm -rf "$TMP"
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  return 0
}

usage() {
  say "Morse installer. Usage: install.sh [--uninstall [--all]] [--no-setup]"
}

# ---------------------------------------------------------------- checks
need_node() {
  os="$1"
  have=""
  if command -v node >/dev/null 2>&1; then
    have=$(node -p 'process.versions.node' 2>/dev/null || true)
  fi
  major=${have%%.*}
  case "$major" in ''|*[!0-9]*) major=0 ;; esac
  if [ "$major" -ge 22 ] && command -v npm >/dev/null 2>&1; then
    return 0
  fi
  if [ -n "$have" ] && [ "$major" -lt 22 ]; then
    why="Morse needs Node 22 or newer. This computer has Node $have."
  elif [ -n "$have" ]; then
    why="Morse needs npm, which comes with Node, but it isn't on your PATH."
  else
    why="Morse needs Node 22 or newer, and this computer doesn't have it yet."
  fi
  if [ "$os" = Darwin ]; then
    fail "$why
  Get it one of these ways, then run the same line again:
    • with Homebrew:  brew install node
    • or download the installer from https://nodejs.org (the LTS version)"
  fi
  fail "$why
  Get it from https://nodejs.org/en/download (it shows the command for your
  system), then run the same line again."
}

need_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "Morse's installer needs $1, which isn't on this computer. Install it, then run the same line again."
}

# ---------------------------------------------------------------- downloads
# download <url> <file>: 0 when it worked, 22 when the server said no (404),
# anything else when the network failed.
download() {
  case "$1" in
    https://*) curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 -o "$2" "$1" ;;
    http://127.0.0.1[:/]*|http://localhost[:/]*) curl -fsSL --retry 2 -o "$2" "$1" ;; # tests
    *) fail "Won't download from $1: only https addresses." ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"
  fi
}

# The package from the preview release, checked. Sets PKG, PKG_FROM and
# PKG_SHA, or leaves PKG empty when there is no release yet.
fetch_release() {
  rc=0
  download "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" 2>/dev/null || rc=$? # a 404 here isn't an error: no release yet
  if [ "$rc" -eq 22 ]; then
    return 0 # no release yet
  elif [ "$rc" -ne 0 ]; then
    fail "Couldn't reach GitHub to download Morse (curl said $rc). Check your internet connection and run the same line again."
  fi
  step "Downloading Morse…"
  rc=0
  download "$BASE/morse-cli.tgz" "$TMP/morse-cli.tgz" || rc=$?
  [ "$rc" -eq 0 ] || fail "Couldn't download $BASE/morse-cli.tgz (curl said $rc). Run the same line again in a minute."
  want=$(sed -n 's/^\([0-9a-fA-F]\{64\}\)[ *][ *]*morse-cli\.tgz$/\1/p' "$TMP/SHA256SUMS" | head -n 1 | tr 'A-F' 'a-f')
  [ -n "$want" ] || fail "The release's SHA256SUMS has no line for morse-cli.tgz, so the download can't be checked. Nothing was installed."
  got=$(sha256_of "$TMP/morse-cli.tgz")
  if [ "$got" != "$want" ]; then
    fail "The download doesn't match its checksum, so it wasn't installed.
  expected $want
  got      $got
  Run the same line again. If it still fails, tell us: https://github.com/$REPO/issues"
  fi
  step "✓ Checked the download against the release's SHA256SUMS."
  PKG="$TMP/morse-cli.tgz"
  PKG_FROM="release"
  PKG_SHA="$got"
}

# No release yet: the main branch, built here into the same package.
build_from_main() {
  step "No preview release yet, so Morse is built from the main branch (a bigger download, about a minute)."
  rc=0
  download "$SOURCE" "$TMP/main.tar.gz" || rc=$?
  [ "$rc" -eq 0 ] || fail "Couldn't download Morse from $SOURCE (curl said $rc). Check your internet connection and run the same line again."
  mkdir "$TMP/src"
  # Everything but the pictures and videos in docs/, which the package doesn't need.
  tar -xzf "$TMP/main.tar.gz" -C "$TMP/src" --exclude='*/docs/*' 2>/dev/null || tar -xzf "$TMP/main.tar.gz" -C "$TMP/src"
  src=""
  for d in "$TMP"/src/*; do [ -f "$d/package.json" ] && src="$d"; done
  [ -n "$src" ] || fail "The download from $SOURCE isn't the Morse source. Nothing was installed."
  step "Building Morse…"
  # MORSE_STORE=1: the extension as the Chrome Web Store gets it. npm pack builds it
  # again (its prepare script), so it needs the setting too.
  (cd "$src" && export MORSE_STORE=1 && npm ci --no-audit --no-fund --loglevel=error >"$TMP/build.log" 2>&1 \
    && npm pack --pack-destination "$TMP" >>"$TMP/build.log" 2>&1) \
    || { cat "$TMP/build.log" >&2; fail "Building Morse from the main branch failed (above)."; }
  for f in "$TMP"/morse-cli-*.tgz; do mv "$f" "$TMP/morse-cli.tgz"; done
  [ -f "$TMP/morse-cli.tgz" ] || fail "Building Morse made no package. Nothing was installed."
  PKG="$TMP/morse-cli.tgz"
  PKG_FROM="main"
  PKG_SHA=$(sha256_of "$PKG")
}

# ---------------------------------------------------------------- the morse command
on_path() {
  case ":$PATH:" in *":$1:"*) return 0 ;; esac
  return 1
}
writable_dir() { [ -d "$1" ] && [ -w "$1" ]; }

# Where the morse command goes: MORSE_BIN_DIR; else ~/.local/bin when it's on
# PATH; else npm's folder for commands when it's on PATH and yours (Homebrew's
# /opt/homebrew/bin, nvm); else ~/.local/bin, and we say which line to add.
pick_bin_dir() {
  if [ -n "${MORSE_BIN_DIR:-}" ]; then BIN="$MORSE_BIN_DIR"; return; fi
  if on_path "$HOME/.local/bin"; then BIN="$HOME/.local/bin"; return; fi
  npmbin="$(npm prefix -g 2>/dev/null || true)/bin"
  if [ "$npmbin" != "/bin" ] && on_path "$npmbin" && writable_dir "$npmbin"; then BIN="$npmbin"; return; fi
  BIN="$HOME/.local/bin"
}

is_ours() { [ -f "$1" ] && head -n 3 "$1" 2>/dev/null | grep -q "$MARK"; }

write_shim() {
  mkdir -p "$BIN"
  SHIM="$BIN/morse"
  if [ -e "$SHIM" ] && ! is_ours "$SHIM"; then
    step "! There is already a morse command at $SHIM that this installer didn't make, so it was left alone."
    step "  This Morse runs with: node \"$APP/daemon/cli.js\""
    SHIM=""
    return
  fi
  node_now=$(command -v node)
  cat >"$SHIM.tmp" <<EOF
#!/bin/sh
# $MARK. \`morse uninstall\` removes it.
if command -v node >/dev/null 2>&1; then exec node "$APP/daemon/cli.js" "\$@"; fi
exec "$node_now" "$APP/daemon/cli.js" "\$@"
EOF
  chmod 755 "$SHIM.tmp"
  mv -f "$SHIM.tmp" "$SHIM"
}

# ---------------------------------------------------------------- uninstall
receipt_value() { [ -f "$RECEIPT" ] && sed -n "s/^$1=//p" "$RECEIPT" | head -n 1; }

uninstall() {
  all="$1"
  if [ ! -f "$RECEIPT" ] && [ ! -d "$APP" ]; then
    say "Morse isn't installed by this installer here ($MORSE_DIR), so there is nothing to remove."
    exit 0
  fi
  shim=$(receipt_value shim || true)
  if [ -n "$shim" ] && is_ours "$shim"; then rm -f "$shim"; step "Removed $shim"; fi
  rm -rf "$APP" "$EXT" "$MORSE_DIR/.app-new" "$MORSE_DIR/.extension-new"
  step "Removed $APP and $EXT"
  if [ "$all" = 1 ]; then
    rm -rf "$MORSE_DIR"
    step "Removed $MORSE_DIR (your mods and settings)"
  else
    rm -f "$RECEIPT"
    step "Your mods and settings are still in $MORSE_DIR. Delete that folder to remove them too."
  fi
  say "Morse is removed. If you added it to Chrome, remove it there too: chrome://extensions, Morse, Remove."
}

# ---------------------------------------------------------------- install
main() {
  do_uninstall=0; all=0; setup=1
  for a in "$@"; do
    case "$a" in
      --uninstall) do_uninstall=1 ;;
      --all) all=1 ;;
      --no-setup) setup=0 ;;
      -h|--help) usage; exit 0 ;;
      *) usage; fail "Unknown option: $a" ;;
    esac
  done
  [ -n "${MORSE_NO_SETUP:-}" ] && setup=0
  if [ "$do_uninstall" = 1 ]; then uninstall "$all"; return; fi

  os=$(uname -s)
  case "$os" in
    Darwin|Linux) ;;
    MINGW*|MSYS*|CYGWIN*) fail "On Windows, open PowerShell and run:
  irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex" ;;
    *) fail "Morse's installer works on macOS and Linux (and Windows with install.ps1), not on $os." ;;
  esac
  [ -n "${HOME:-}" ] || fail "HOME isn't set, so there is no place to put Morse."

  say "▦ Installing Morse"
  need_node "$os"
  need_tool curl
  need_tool tar

  TMP=$(mktemp -d 2>/dev/null || mktemp -d -t morse)
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT TERM

  PKG=""; PKG_FROM=""; PKG_SHA=""
  fetch_release
  [ -n "$PKG" ] || build_from_main

  mkdir -p "$MORSE_DIR"
  chmod 700 "$MORSE_DIR" 2>/dev/null || true
  old_sha=$(receipt_value sha256 || true)
  if [ "$old_sha" = "$PKG_SHA" ] && [ -f "$APP/daemon/cli.js" ] && [ -f "$APP/dist/extension/manifest.json" ]; then
    status="already up to date"
  else
    [ -f "$APP/daemon/cli.js" ] && status="updated" || status="installed"
    # Unpack next to the old one, get its one dependency, then swap.
    STAGE="$MORSE_DIR/.app-new"
    rm -rf "$STAGE"
    mkdir -p "$STAGE"
    tar -xzf "$PKG" -C "$STAGE"
    [ -f "$STAGE/package/daemon/cli.js" ] && [ -f "$STAGE/package/dist/extension/manifest.json" ] \
      || fail "The package has no Morse in it. Nothing was installed."
    step "Getting Morse's one dependency from npm…"
    (cd "$STAGE/package" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock --loglevel=error >"$TMP/npm.log" 2>&1) \
      || { cat "$TMP/npm.log" >&2; fail "npm couldn't get Morse's dependency (above). Check your internet connection and run the same line again."; }
    rm -rf "$APP.old"
    [ -d "$APP" ] && mv "$APP" "$APP.old"
    mv "$STAGE/package" "$APP"
    rm -rf "$APP.old" "$STAGE"
    STAGE=""
  fi

  # The Chrome extension, in a folder that stays put (Morse Desktop uses it too).
  rm -rf "$MORSE_DIR/.extension-new"
  cp -R "$APP/dist/extension" "$MORSE_DIR/.extension-new"
  rm -rf "$EXT"
  mv "$MORSE_DIR/.extension-new" "$EXT"

  pick_bin_dir
  write_shim
  version=$(node "$APP/daemon/cli.js" --version 2>/dev/null || echo "?")
  {
    say "# $MARK. \`morse uninstall\` removes what is listed here."
    say "version=$version"
    say "sha256=$PKG_SHA"
    say "source=$PKG_FROM"
    say "app=$APP"
    say "extension=$EXT"
    say "shim=$SHIM"
    say "installed=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$RECEIPT.tmp"
  mv -f "$RECEIPT.tmp" "$RECEIPT"
  step "✓ Morse $version $status${SHIM:+: $SHIM}"

  morse="node $APP/daemon/cli.js"
  path_line=""
  if [ -n "$SHIM" ] && ! on_path "$BIN"; then
    case "${SHELL:-}" in */zsh) rc="$HOME/.zshrc" ;; */bash) rc="$HOME/.bashrc"; [ "$os" = Darwin ] && rc="$HOME/.bash_profile" ;; *) rc="$HOME/.profile" ;; esac
    path_line="echo 'export PATH=\"$BIN:\$PATH\"' >> $rc"
  elif [ -n "$SHIM" ]; then
    other=$(command -v morse 2>/dev/null || true)
    if [ -n "$other" ] && [ "$other" != "$SHIM" ]; then
      step "! Another morse command comes first on your PATH: $other. Remove it (npm uninstall -g morse-cli) to use this one."
    fi
    morse="morse"
  fi

  if [ "$setup" = 1 ]; then
    say ""
    # Piped into sh, the questions come from the terminal itself; without one, none are asked.
    if [ -t 1 ] && (: </dev/tty) 2>/dev/null; then
      node "$APP/daemon/cli.js" setup --auto </dev/tty || step "! morse setup didn't finish. Run it again any time: morse setup"
    else
      node "$APP/daemon/cli.js" setup --auto </dev/null || step "! morse setup didn't finish. Run it again any time: morse setup"
    fi
  fi

  if [ "$os" = Darwin ]; then key="⌥Space"; pick=" (in that window: ⌘⇧G, then paste it)"; else key="Ctrl+Shift+Space"; pick=""; fi
  case "$EXT" in "$HOME"/*) ext_shown="~${EXT#"$HOME"}" ;; *) ext_shown="$EXT" ;; esac
  say ""
  if [ -n "$path_line" ]; then
    say "One more line, so your terminal finds the morse command (then open a new terminal):"
    say "  $path_line"
    say ""
  fi
  say "Next:"
  say "  1. Chrome: open chrome://extensions, turn on Developer mode, click Load unpacked, choose $ext_shown$pick"
  say "  2. Desktop apps: $morse launch obsidian, or Morse Desktop: $PREVIEW_PAGE"
  say "  3. Press $key on a page or in the app, point at something, and say what to change."
}

main "$@"
