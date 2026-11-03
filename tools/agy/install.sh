#!/usr/bin/env bash
# Links the office's scripts and skills from this folder into place, so this folder stays the one source.
# Safe to run again. Accounts are not touched: each one signs in once with `agy-as accN` (see README.md).
set -eu
here=$(dirname "$(readlink -f "$0")")
bin="$HOME/.local/bin"
skills="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
mkdir -p "$bin" "$skills"

for f in agy-as agy-up agy-mode agy-sync; do ln -sfn "$here/bin/$f" "$bin/$f"; done
ln -sfn "$here/bin/worker-ask" "$bin/agy-ask"
ln -sfn agy-ask "$bin/claude-ask"
for s in "$here"/skills/*/; do ln -sfn "${s%/}" "$skills/$(basename "$s")"; done

echo "Installed from $here. In a running Claude Code session: /reload-plugins."
case ":$PATH:" in *":$bin:"*) ;; *) echo "Add $bin to your PATH." ;; esac
