#!/bin/bash
# Double-click to publish a new RepoHub release (builds the .dmg on GitHub and
# makes it available as an in-app update). Bumps the patch version each time.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.homebrew/bin:$PATH"
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
command -v node >/dev/null || { echo "Node.js is needed (run Install RepoHub.command once first)."; read -r -p "Press Return to close." _; exit 1; }
command -v gh >/dev/null || { echo "GitHub CLI is needed: brew install gh, then gh auth login."; read -r -p "Press Return to close." _; exit 1; }
node scripts/release.mjs "$@"
status=$?
echo
read -r -p "Press Return to close." _
exit $status
