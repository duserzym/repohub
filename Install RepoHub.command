#!/bin/bash
# Double-click in Finder to build RepoHub and install it in Applications.
# Safe to run again: it rebuilds and replaces the installed copy.
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf "\n\033[1m%s\033[0m\n" "$1"; }
fail() { printf "\n\033[31m✕ %s\033[0m\n" "$1"; read -r -p "Press Return to close." _; exit 1; }
ok() { printf "\033[32m✓\033[0m %s\n" "$1"; }

bold "RepoHub installer"

# 1. Apple command line tools (compiler + git)
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  fail "Install the Command Line Tools in the window that just opened, then double-click this file again."
fi
ok "Command line tools"

# 2. Node.js 20+
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.homebrew/bin:$PATH"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  if command -v brew >/dev/null 2>&1; then
    bold "Installing Node.js with Homebrew…"
    brew install node
  else
    open "https://nodejs.org/en/download"
    fail "Node.js 20 or newer is needed. Install it from the page that opened, then run this again."
  fi
fi
ok "Node $(node -v)"

# 3. Rust
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
if ! command -v cargo >/dev/null 2>&1; then
  bold "Installing Rust (rustup)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  source "$HOME/.cargo/env"
fi
ok "Rust $(rustc --version | awk '{print $2}')"

# 4. GitHub sign-in is built in (RepoHub's OAuth App client ID ships with the app),
#    so there is nothing to set up here. To use your own OAuth App instead, put
#    VITE_GITHUB_CLIENT_ID=... in a .env file next to this script.

# 5. Build
bold "Installing dependencies…"
npm ci --no-audit --no-fund
bold "Building RepoHub (the first build takes a few minutes)…"
npx tauri build --bundles app

APP="src-tauri/target/release/bundle/macos/RepoHub.app"
[ -d "$APP" ] || fail "Build finished but $APP was not found."

# 6. Install
DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
osascript -e 'tell application "RepoHub" to quit' >/dev/null 2>&1 || true
rm -rf "$DEST/RepoHub.app"
ditto "$APP" "$DEST/RepoHub.app"
codesign --force --deep --sign - "$DEST/RepoHub.app" >/dev/null 2>&1 || true
ok "Installed to $DEST/RepoHub.app"

open "$DEST/RepoHub.app"
bold "RepoHub is running. Look for its icon in the menu bar."
read -r -t 10 -p "This window closes in 10 seconds…" _ || true
