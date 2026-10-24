#!/data/data/com.termux/files/usr/bin/bash
set -eu

cd "$(dirname "$0")"
PORT="${PORT:-3000}"
URL="http://127.0.0.1:${PORT}/health"
LOG="$HOME/anb-private-chat-server.log"
PIDFILE="$HOME/anb-private-chat-server.pid"

case "${1:-start}" in
  start)
    if curl -fsS "$URL" >/dev/null 2>&1; then
      echo "ANB Private Chat backend is already responding."
      curl -sS "$URL"
      echo
      exit 0
    fi

    nohup npm start >"$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 2

    if curl -fsS "$URL"; then
      echo
      echo "Backend health check passed."
    else
      echo "Backend did not become healthy. Recent log:"
      tail -n 30 "$LOG" || true
      exit 1
    fi
    ;;
  status)
    curl -i "$URL"
    ;;
  *)
    echo "Usage: bash termux-backend.sh [start|status]"
    exit 2
    ;;
esac
