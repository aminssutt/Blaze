#!/usr/bin/env bash
# BLAZE — launch Gemma 4 on the demo VM (validated 2026-07-25 on NVIDIA L40S 48GB, Ubuntu 22.04, vLLM 0.25.1).
#
# Run ON the VM, inside a tmux session so it survives SSH disconnects:
#   tmux new-session -d -s vllm "bash scripts/ai/serve_gemma_vm.sh"
# Logs: ~/vllm.log · Attach: tmux attach -t vllm · Stop: tmux kill-session -t vllm
#
# Notes (learned the hard way):
# - VLLM_USE_FLASHINFER_SAMPLER=0 is REQUIRED on this VM: no CUDA toolkit (nvcc) is
#   installed, and flashinfer's JIT sampling build fails with
#   "Could not find nvcc and default cuda_home='/usr/local/cuda' doesn't exist".
#   The PyTorch sampler fallback is functionally identical for our use.
# - The gemma4 tool-call chat template is not bundled; fetch it once:
#     curl -o ~/tool_chat_template_gemma4.jinja \
#       https://raw.githubusercontent.com/vllm-project/vllm/main/examples/tool_chat_template_gemma4.jinja
# - Binds 0.0.0.0 by default so Docker containers (backend) can reach it via
#   host.docker.internal; the provider firewall blocks every inbound port except
#   SSH (verified), so nothing is actually exposed. Override with VLLM_BIND_HOST.
# - Browser access stays via SSH tunnel:
#     ssh -N -L 8000:localhost:8000 -L 8080:localhost:8080 -L 3000:localhost:3000 shadeform@<VM_IP>

set -euo pipefail

MODEL="${GEMMA_MODEL_ID:-google/gemma-4-E4B-it}"
TEMPLATE="${GEMMA_TOOL_TEMPLATE:-$HOME/tool_chat_template_gemma4.jinja}"

if [ ! -f "$TEMPLATE" ]; then
  echo "Fetching gemma4 tool chat template..."
  curl -sf -o "$TEMPLATE" \
    https://raw.githubusercontent.com/vllm-project/vllm/main/examples/tool_chat_template_gemma4.jinja
fi

exec env VLLM_USE_FLASHINFER_SAMPLER=0 vllm serve "$MODEL" \
  --host "${VLLM_BIND_HOST:-0.0.0.0}" --port 8000 \
  --dtype bfloat16 \
  --max-model-len 8192 \
  --enable-auto-tool-choice \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --chat-template "$TEMPLATE" \
  2>&1 | tee "$HOME/vllm.log"
