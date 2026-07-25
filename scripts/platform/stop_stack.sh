#!/usr/bin/env bash
# BLAZE stack teardown (issue #37). State is in-memory: stopping = full reset.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$REPO_ROOT/.stack-logs"

for name in frontend backend vllm; do
  pidfile="$LOG_DIR/$name.pid"
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile")"
    if kill "$pid" 2>/dev/null; then echo "[stack] stopped $name (pid $pid)"; fi
    rm -f "$pidfile"
  fi
done
# belt and suspenders for orphans
pkill -f "uvicorn backend.api.main" 2>/dev/null || true
echo "[stack] down ✔"
