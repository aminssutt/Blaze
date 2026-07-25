#!/usr/bin/env bash
# BLAZE native startup (issue #37) — same order and health gates as compose,
# for machines where GPU-in-Docker is unavailable (e.g. macOS dev laptop).
#
# Usage:
#   ./scripts/platform/start_stack.sh              # full stack (needs vLLM env)
#   SKIP_VLLM=1 ./scripts/platform/start_stack.sh  # mock/offline mode
#
# Teardown: ./scripts/platform/stop_stack.sh
# Reset a run without restarting: curl -X POST localhost:8080/incident/reset

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"
set -a; source .env; set +a

LOG_DIR="$REPO_ROOT/.stack-logs"; mkdir -p "$LOG_DIR"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

wait_healthy() { # url name tries
  local url="$1" name="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$url" >/dev/null 2>&1; then echo "[stack] $name healthy"; return 0; fi
    sleep 2
  done
  echo "[stack] ERROR: $name never became healthy ($url)" >&2; return 1
}

# 1. vLLM first — backend must not accept /incident/start against a cold model.
if [[ "${SKIP_VLLM:-0}" == "1" ]]; then
  echo "[stack] SKIP_VLLM=1 — mock/offline mode, no model server"
else
  if ! curl -sf "${VLLM_BASE_URL}/health" >/dev/null 2>&1; then
    echo "[stack] starting vLLM (${GEMMA_MODEL_ID})..."
    nohup python3 -m vllm.entrypoints.openai.api_server \
      --model "${GEMMA_MODEL_ID}" --host 0.0.0.0 --port 8000 \
      --api-key "${VLLM_API_KEY:-local-only-placeholder}" \
      > "$LOG_DIR/vllm.log" 2>&1 &
    echo $! > "$LOG_DIR/vllm.pid"
  fi
  wait_healthy "${VLLM_BASE_URL}/health" "vLLM" 90
fi

# 2. Backend, gated on vLLM above.
echo "[stack] starting backend..."
nohup backend/.venv/bin/uvicorn backend.api.main:app \
  --host "${BACKEND_HOST:-0.0.0.0}" --port "$BACKEND_PORT" \
  > "$LOG_DIR/backend.log" 2>&1 &
echo $! > "$LOG_DIR/backend.pid"
wait_healthy "http://localhost:${BACKEND_PORT}/health" "backend" 30

# 3. Frontend last, pointed at the healthy backend.
if [[ ! -d frontend/node_modules ]]; then
  echo "[stack] installing frontend deps (first run)..."
  (cd frontend && npm ci --silent > "$LOG_DIR/npm-ci.log" 2>&1)
fi
echo "[stack] starting frontend..."
(cd frontend && NEXT_PUBLIC_BACKEND_URL="http://localhost:${BACKEND_PORT}" \
  nohup npm run dev -- --port "$FRONTEND_PORT" \
  > "$LOG_DIR/frontend.log" 2>&1 & echo $! > "$LOG_DIR/frontend.pid")
wait_healthy "http://localhost:${FRONTEND_PORT}" "frontend" 60

echo
echo "[stack] up ✔  backend: http://localhost:${BACKEND_PORT}/health · frontend: http://localhost:${FRONTEND_PORT}"
echo "[stack] logs in .stack-logs/ · teardown: ./scripts/platform/stop_stack.sh"
