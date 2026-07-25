# Serving Gemma 4 locally with vLLM

The 5 BLAZE agents share **one** local vLLM deployment. The client
(`agents/common/inference_client.py`) talks to it via the OpenAI-compatible API at
`{VLLM_BASE_URL}/v1/chat/completions` and refuses any non-local URL
(`cloud_calls` must stay 0 — the demo is 100% local).

## Start the server (GPU machine)

```bash
pip install vllm

vllm serve google/gemma-4-E4B-it \
  --host 127.0.0.1 --port 8000 \
  --enable-auto-tool-choice \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90
```

- `--enable-auto-tool-choice` + `--tool-call-parser gemma4`: function calling with
  `tools` / `tool_choice` in the request body (used by Situation Context & Planning agents).
- `--reasoning-parser gemma4`: separates reasoning from the final answer in responses.
- Structured output: the client sends `response_format: {"type": "json_schema", ...}`;
  vLLM enforces it with guided decoding (plus a client-side jsonschema repair loop).

## Environment for the client

```bash
VLLM_BASE_URL=http://localhost:8000
VLLM_API_KEY=local-only-placeholder   # vLLM does not check it locally
GEMMA_MODEL_ID=google/gemma-4-E4B-it
# BLAZE_ALLOW_REMOTE_INFERENCE=true   # DEV ONLY — never during the demo
```

## VRAM per checkpoint (approximate, bf16, 8k context)

| Checkpoint | Weights | Recommended GPU |
|---|---|---|
| `google/gemma-4-E2B-it` | ~ 6 GB | 8 GB+ (RTX 3070/4060 Ti) |
| `google/gemma-4-E4B-it` | ~ 10 GB | 16 GB+ (RTX 4080/A4000) — **demo default** |

Add KV-cache headroom (~2–4 GB at 8k context). If VRAM is tight: lower
`--max-model-len`, reduce `--gpu-memory-utilization`, or fall back to the E2B checkpoint
(same client, just change `GEMMA_MODEL_ID`).

## Smoke test

```bash
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "google/gemma-4-E4B-it", "messages": [{"role": "user", "content": "ping"}]}'
```

No GPU on this machine? The client test suite mocks this exact API with `respx`:
`cd agents/common && pytest`.
