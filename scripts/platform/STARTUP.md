# BLAZE — Stack startup, teardown & reset (issue #37)

## One command

| Machine | Command |
|---|---|
| Demo machine (NVIDIA GPU, Docker) | `docker compose up -d` |
| Without model server (mock/offline) | `docker compose up -d backend frontend` |
| macOS / no GPU-in-Docker | `./scripts/platform/start_stack.sh` (add `SKIP_VLLM=1` for mock mode) |

## Startup order (health-gated in both paths)

1. **vLLM** — serves `GEMMA_MODEL_ID`; waited on via `GET /health` (up to 3 min
   for model load).
2. **Backend** — started only after vLLM is healthy, so `/incident/start`
   never runs against a cold model server; waited on via `GET /health`.
3. **Frontend** — started only after the backend is healthy
   (`NEXT_PUBLIC_BACKEND_URL` pre-wired).

All ports/paths come from `.env` (`BACKEND_PORT`, `FRONTEND_PORT`,
`VLLM_BASE_URL`, `GEMMA_MODEL_ID`, …) — nothing hardcoded.

## Teardown

- Compose: `docker compose down`
- Native: `./scripts/platform/stop_stack.sh` (kills pids from `.stack-logs/`)

## Reset between demo runs (no restart needed)

State is in-memory by design (deterministic reruns):

```bash
curl -X POST http://localhost:8080/incident/reset
```

returns the system to IDLE: sequence restarts at 1, plans/decisions wiped,
seeded scenario state restored. A full teardown+startup gives the same result.

Logs (native mode): `.stack-logs/{vllm,backend,frontend}.log`.
