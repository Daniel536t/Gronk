#!/usr/bin/env bash
# Start the Gronk's Hoard game server indefinitely under nohup (no pm2 needed).
# Builds the frontend if dist/ is missing, then runs the single-port server.
#
#   ./start-server.sh            # start (or restart) on :8787
#   ./start-server.sh stop       # stop the running instance
#   ./start-server.sh status     # is it up? which PID?
#
# Logs go to server.log (stdout+stderr) in the project root.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
PORT="${PORT:-8787}"
PIDFILE="server.pid"
LOGFILE="server.log"
NODE_BIN="$(command -v node)"

stop() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "Stopping server (pid $(cat "$PIDFILE"))."
    kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE"
  else
    echo "No running server (pidfile absent or stale)."
    rm -f "$PIDFILE"
  fi
}

case "${1:-start}" in
  stop)
    stop
    ;;
  status)
    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Running: pid $(cat "$PIDFILE"), port :$PORT, log $LOGFILE"
      exit 0
    fi
    echo "Not running."
    exit 1
    ;;
  start)
    stop
    # Build the frontend once so single-port prod mode can serve it.
    if [[ ! -d dist || -z "$(find dist -name 'index.html' 2>/dev/null)" ]]; then
      echo "dist/ missing — building the frontend first."
      npm run build
    fi
    echo "Starting server on :$PORT ..."
    nohup node --import tsx src/server/index.ts >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    sleep 1
    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Up (pid $(cat "$PIDFILE")). Visit http://localhost:$PORT  (log: tail -f $LOGFILE)"
    else
      echo "Failed to start. Check $LOGFILE"
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac