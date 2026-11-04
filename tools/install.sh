#!/usr/bin/env bash
# Links worker-ask (also agy-ask, claude-ask), agy-as and bang-init from this repo into ~/.local/bin, and removes what the
# old Vi-Habblaud install left behind (only symlinks whose target is under a Vi-Habblaud folder, never anything else).
# --worker also fills ~/.claude-worker/skills with the skills of the main Claude account, for the Claude seats.
# Safe to run again: the second run changes nothing and prints no change. Accounts are not touched: sign in once with `agy-as accN`.
set -eu
[ $# -eq 0 ] || [ "$*" = "--worker" ] || { echo "usage: tools/install.sh [--worker]" >&2; exit 1; }
agy="$(dirname "$(readlink -f "$0")")/agy"
bin="$HOME/.local/bin"
vi='*/Vi-Habblaud/*'
mkdir -p "$bin"

link() {  # link <target> <path>: say so only when it changes
  if [ -e "$2" ] || [ -L "$2" ]; then
    if [ ! -L "$2" ]; then echo "left $2: not a link" >&2; return 0; fi
  fi
  if [ "$(readlink "$2" 2>/dev/null)" != "$1" ]; then ln -sfn "$1" "$2"; echo "linked $2"; fi
}
drop_vi() {  # drop_vi <path>: remove a symlink into Vi-Habblaud (harmless elsewhere: nothing else points there)
  if [ -L "$1" ]; then
    case "$(readlink "$1")" in $vi) rm "$1"; echo "removed $1" ;; esac
  fi
}

for f in worker-ask agy-as bang-init advisor; do
  if [ -f "$agy/bin/$f" ]; then link "$agy/bin/$f" "$bin/$f"; fi
done
link worker-ask "$bin/agy-ask"
link worker-ask "$bin/claude-ask"

# migration from Vi-Habblaud
for l in "$bin"/* "$HOME/.claude/skills/agy-orchestrator" "$HOME/.claude/skills/office-rules"; do drop_vi "$l"; done
root="${HABBLAUD_AGY_PROFILES:-$HOME/.agy_profiles}"
for d in "$root"/acc*/.gemini/config/plugins/office-rules; do
  if [ -L "$d" ]; then drop_vi "$d"
  elif [ -d "$d" ]; then
    for l in "$d"/*; do drop_vi "$l"; done
    if rmdir "$d" 2>/dev/null; then echo "removed $d"; else echo "left $d: holds files the old installer did not make"; fi
  fi
done

if [ "${1:-}" = "--worker" ]; then
  w="$HOME/.claude-worker/skills"
  mkdir -p "$w"
  repo=$(readlink -f "$agy/../..")
  n=0 seen=" "
  for d in $("$agy/bin/skill-dirs" "$HOME"); do  # shortcut: paths with spaces are skipped, as in skill-dirs
    if [ "$(readlink -f "$d")" = "$repo/skills" ]; then continue; fi  # the Bang_ver skills come through the office folder
    for s in "$d"/*/; do
      s="${s%/}"; name=$(basename "$s"); t="$w/$name"
      if [ ! -f "$s/SKILL.md" ]; then continue; fi
      case "$seen" in *" $name "*) continue ;; esac
      seen="$seen$name "
      if [ -L "$t" ] && [ "$(readlink "$t")" = "$s" ]; then continue; fi
      if [ -L "$t" ]; then  # a link into ~/.claude goes stale when a plugin updates; any other link stays
        case "$(readlink "$t")" in "$HOME/.claude/"*) rm "$t"; echo "removed $t" ;; esac
      fi
      if [ -e "$t" ] || [ -L "$t" ]; then echo "left $t: already there"; else ln -s "$s" "$t"; n=$((n + 1)); fi
    done
  done
  for l in "$w"/*; do  # links into ~/.claude whose skill is gone
    if [ -L "$l" ]; then
      case "$seen" in *" $(basename "$l") "*) continue ;; esac
      case "$(readlink "$l")" in "$HOME/.claude/"*) rm "$l"; echo "removed $l" ;; esac
    fi
  done
  if [ "$n" -gt 0 ]; then echo "linked $n skills into $w"; fi
  folder=$(python3 -c 'import json,os,sys; print(json.load(open(os.path.join((os.environ.get("HABBLAUD_DATA_DIR") or "").strip() or sys.argv[1]+"/.habblaud","team.json"))).get("folder") or "")' "$HOME" 2>/dev/null || true)
  echo "Sign in once: cd ${folder:-<office folder>} && CLAUDE_CONFIG_DIR=$HOME/.claude-worker claude"
  echo "(sign in with the same account, trust the folder, then /exit)"
fi

case ":$PATH:" in *":$bin:"*) ;; *) echo "Add ~/.local/bin to your PATH." ;; esac
