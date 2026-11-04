#!/bin/sh
# npm run office [-- start|stop|restart]: builds and starts the office in the background, apart from any terminal (a
# session opened in its web terminal lives inside this server, so it must outlive the shell that started it). Then open
# the address it prints. stop and restart act only on this repo's own server on the port, never on another process.
set -eu
cd "$(dirname "$0")/.."
root="$(pwd -P)"
port="${HABBLAUD_PORT:-4747}"
url="http://127.0.0.1:$port"
log="${HABBLAUD_DATA_DIR:-$HOME/.habblaud}/office.log"

listener() { ss -Hltnp "sport = :$port" | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2 || true; }

launch() {
  mkdir -p "${log%/*}"
  HABBLAUD_PTY=1 setsid nohup node dist/server/index.js > "$log" 2>&1 < /dev/null &
  echo "The office is starting: $url (log: $log)"
}

stop_office() {
  command -v ss > /dev/null || { echo "ss is not installed: cannot tell what listens on port $port"; return 1; }
  pid="$(listener)"
  if [ -z "$pid" ]; then
    if ss -Hltn "sport = :$port" | grep -q .; then
      echo "port $port has a listener whose pid is not visible: not stopped"
      return 1
    fi
    echo "The office is not running on port $port"
    return 0
  fi
  cwd="$(readlink "/proc/$pid/cwd" || true)"
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" | sed 's/ $//' || true)"
  if [ "$cwd" != "$root" ] || [ "$cmd" != "node dist/server/index.js" ]; then
    echo "port $port belongs to another server (pid $pid, $cwd): not stopped"
    return 1
  fi
  kill "$pid" || { echo "could not signal pid $pid"; return 1; }
  i=0
  while [ "$i" -lt 20 ]; do
    if ! kill -0 "$pid" 2> /dev/null && [ -z "$(listener)" ]; then
      echo "The office is stopped (pid $pid)"
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  echo "The office (pid $pid) is still running after 10 s"
  return 1
}

case "${1:-start}" in
  start)
    if curl -s -o /dev/null --max-time 2 "$url/"; then
      echo "The office is already running: $url"
      exit 0
    fi
    npm run build --silent
    launch ;;
  stop) stop_office ;;
  restart)
    npm run build --silent
    stop_office
    launch ;;
  *) echo "usage: office.sh [start|stop|restart]"; exit 1 ;;
esac
