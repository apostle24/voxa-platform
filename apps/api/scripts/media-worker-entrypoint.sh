#!/bin/sh
set -eu

# Never start processing with a missing or stale virus database.
echo "[voxa-media-worker] updating ClamAV signatures"
freshclam --stdout

# Keep signatures fresh while the worker runs. Scanner errors remain fail-closed
# because the worker treats a non-zero clamscan exit code as a processing failure.
freshclam --daemon --checks=24 --foreground &
FRESHCLAM_PID=$!

shutdown() {
  kill -TERM "$WORKER_PID" 2>/dev/null || true
  kill -TERM "$FRESHCLAM_PID" 2>/dev/null || true
  wait "$WORKER_PID" 2>/dev/null || true
  wait "$FRESHCLAM_PID" 2>/dev/null || true
}
trap shutdown TERM INT

gosu voxa:voxa node apps/api/scripts/media-worker.cjs &
WORKER_PID=$!
wait "$WORKER_PID"
