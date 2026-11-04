# Sourced by office.sh: load_hub_env FILE exports HABBLAUD_* settings from a hub.env WITHOUT executing it.
# Accepts KEY=bare (letters, digits and . _ @ , : / + = -) or KEY='single quoted without a quote inside'; anything else is skipped.
load_hub_env() {
  [ -f "$1" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    k=${line%%=*}
    v=${line#*=}
    case "$k" in
      HABBLAUD_*) ;;
      *) continue ;;
    esac
    case "$k" in *[!A-Za-z0-9_]*) continue ;; esac
    case "$v" in
      \'*\')
        v=${v#\'}
        v=${v%\'}
        case "$v" in *\'*) echo "hub.env: skipped $k (unsupported quoting)" >&2; continue ;; esac ;;
      *[!A-Za-z0-9._@,:/+=-]*) echo "hub.env: skipped $k (unsafe value)" >&2; continue ;;
    esac
    export "$k=$v"
  done < "$1"
}
