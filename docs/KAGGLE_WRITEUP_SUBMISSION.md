# BLAZE — Turning Firefighter Radio Into a Live Operational Roadmap

> Five local Gemma 4 agents convert fragmented radio voice into a safety-reviewed, human-approved tactical plan — fully offline on one NVIDIA GPU.
>
> **Track: Autonomous Agents** · Also entering the **NVIDIA GPU Challenge** (Gemma 4 served locally via vLLM).
>
> Working rule kept throughout: **no invented results**. Every number below was measured; the few remaining placeholders are marked `[EVAL]` and are filled only by our evaluation runner.
>
> *(Internal engineering log with full detail: [`KAGGLE_WRITEUP.md`](KAGGLE_WRITEUP.md) in the repo.)*

## The problem

Wildfires are fought under extreme stress and unreliable connectivity. Firefighters continuously describe the fireground over radio — smoke, wind shifts, blocked roads, water levels, explosions. That voice stream is the richest real-time sensor on scene, and it is almost entirely unstructured. The command post must mentally correlate dozens of fragmented, partially contradictory messages while making life-critical decisions. Corrections are the deadliest failure mode: *"the D17 is not fully blocked — light vehicles still pass"* can silently invalidate an earlier assumption; missing it is the difference between a retreat and a trap. And because firegrounds regularly lose network coverage, a cloud AI assistant fails exactly when it is needed.

## The solution

BLAZE is an offline operational-intelligence system built as a genuine autonomous-agent workflow — not a transcription app, not a chatbot:

**radio audio → local STT (faster-whisper) → Radio Intelligence agent → Situation Context agent + territorial tools → Tactical Planning agent → Safety Critic agent → human commander approval (hard gate) → Dispatch agent → local TTS (Piper) → one personalized voice instruction per unit.**

Gemma 4 interprets field communications, chooses tools, correlates information, proposes a plan, adversarially challenges that plan, waits for human approval, and only then writes per-unit dispatch messages. Corrections update the world model **without deleting the audit trail**. Every datum on screen is provenance-labeled (`live_public`, `cached_public`, `seeded_demo`, `human_report`, `model_inference`), and the entire pipeline survives a staged network blackout.

BLAZE is decision support, not an autonomous commander: the human **always** approves, modifies, or rejects before anything is dispatched.

## Architecture

- **Backend** — FastAPI with a deterministic orchestrator: an explicit 15-state incident state machine, SSE event streaming, plan versioning, and a Tool Execution Layer (allowlist + JSON-Schema argument validation + audit trail).
- **Frontend** — Next.js control room: tactical map, radio timeline, agent/tool trace, safety panel, approval controls, per-unit voice dispatch, NVIDIA metrics panel.
- **Inference** — one local Gemma 4 deployment (vLLM, NVIDIA L40S) shared by all five agents; local faster-whisper STT and Piper TTS.
- **Data** — Open-Meteo, NASA FIRMS, Cadastre Etalab, OSM — all cached so the demo never depends on venue Wi-Fi.

A deliberate rule separates **deterministic services** (ingestion, STT, tool execution, approval gate, TTS) from **agents**: we never present a service as an LLM, and agents never execute code — they propose tool calls that the deterministic layer validates against an allowlist.

## The five agents

All implemented, each with its own prompt, frozen I/O schema, and deterministic post-LLM guardrails (180+ passing tests across the repo):

| Agent | Output | Key guardrail |
|---|---|---|
| Radio Intelligence | `RadioEvent[]` + confidence + evidence spans | Evidence must fuzzy-match the transcript or confidence is capped; corrections resolved against recent context |
| Situation Context | Provenance-labeled `SituationSnapshot` | **Provenance lock**: source labels rewritten from real `ToolResult`s — the model cannot claim cached data is live |
| Tactical Planning | Versioned `DraftTacticalPlan` | Evidence IDs verified against real event/tool IDs; append-only plan history; approval forced for high-risk actions |
| Safety Critic | `SafetyReview` (pass/revise/block) | **Hybrid**: 8 deterministic rule checks (water thresholds, retreat routes, vehicle/road compatibility, hazmat perimeter…) that the LLM can escalate but never soften |
| Dispatch | `DispatchInstruction[]`, TTS-ready | Refuses to issue a single LLM call without an `approve` decision; closed location vocabulary blocks invented routes |

The Safety Critic design is the one we defend hardest: we rejected an LLM-only reviewer because an LLM can be talked out of an objection; a water-threshold check cannot. A mechanical `fail` forces revision regardless of the model's opinion (anti-sycophancy test included), and an LLM outage degrades to rules-only with a `revise` floor.

## How Gemma 4 is used

Remove Gemma and nothing works — it is the reasoning layer of every stage.

- **Native function calling** (`--enable-auto-tool-choice --tool-call-parser gemma4`): agents receive a tool catalog and propose `ToolRequest`s with stated reasons; the deterministic layer validates and executes. Hallucinated tool names are discarded without execution; every request/result pair is audited.
- **Structured output by construction**: every call goes through a shared client's `chat_structured()` — the request carries a `json_schema` response format enforced by vLLM guided decoding, the response is re-validated with `jsonschema` against frozen contracts, and a bounded repair loop re-prompts with the exact validation error before raising a typed failure.
- **Checkpoint choice**: `google/gemma-4-E4B-it` in **bf16, unquantized** — a mixture-of-experts (~4B active parameters) whose full-precision weights (~15 GB) fit affordable hardware. We refuse lossy quantization without an evaluation proving it safe: these outputs are safety-critical. An E2B fallback (~6 GB) covers smaller GPUs by changing one environment variable.
- **Hallucination containment is layered, not hoped for**: evidence-span matching, provenance rewriting, ID verification, closed-vocabulary dispatch checks, mechanical safety rules overriding LLM approval, and an evaluation runner that counts unsupported facts. Prompts reduce error rates; code bounds them.
- **Offline is enforced, not claimed**: the inference client raises on any non-local URL, and a shared call log proves `cloud_calls = 0` live in the UI — including during the demo's network blackout.

## NVIDIA deployment (GPU Challenge)

We sized the GPU on our real constraint — not model size, but **concurrency**: five agents hitting one server in parallel, plus STT. The weights are the model's knowledge; the KV cache is its working memory, and cache is what limits concurrent agents. A 24 GB card left almost no cache; an H100 buys training bandwidth we would never use. The L40S is the usable-VRAM-per-dollar sweet spot, with headroom to grow model or context without touching code.

| Metric (all measured on our instance) | Value |
|---|---|
| GPU | NVIDIA L40S, 46 068 MiB · driver 580.126.09 · CUDA 13.0 |
| Engine / model | vLLM 0.25.1 · `google/gemma-4-E4B-it` · bf16 · 8192 ctx |
| Model load | 15.18 GiB, 4.6 s (weights) |
| KV cache | 25.16 GiB → 920 621 tokens → max concurrency ×112 at 8k |
| Single-stream generation | 100 output tokens in 1.92 s end-to-end ≈ 52 tok/s |
| STT (Whisper small, CPU int8) | 9.92 s radio audio transcribed in 2.61 s (RTF 0.26) |
| Cloud LLM calls | 0 — enforced by the client guard |

We do not claim TensorRT-LLM, NIM, or quantization speedups: none are implemented. vLLM was chosen for first-class Gemma 4 support, guided decoding, and efficient concurrent serving.

## Challenges (real ones)

- Whisper `small` mangled domain nouns on radio audio ("D17" → "dédicite"); mitigated with lexicon-aware prompting and STT `initial_prompt`, with honest reporting either way.
- The Safety Critic's water-refill check initially misread a retreat as a refill plan — caught by tests before merge.
- Ground truth beat documentation: listening to the real recordings revealed a mislabeled speaker in the spec; the manifest was corrected against the audio.
- Three developers built in parallel against **frozen JSON contracts** and a mock event stream — the frontend never waited for the backend, and agents never waited for real tools.

## Results

Measured values only; `[EVAL]` rows are produced exclusively by our shipped evaluation harness (27 labeled French radio messages: negations, corrections, vehicle restrictions, ambiguous numbers, contradictions, noisy-STT variants).

| Metric | Value |
|---|---|
| Agents / allowlisted tools / automated tests | 5 / 7 / 180+ passing |
| Valid structured-output rate (live Gemma) | `[EVAL]` |
| Extraction accuracy (unit, location, corrections) | `[EVAL]` |
| Unsupported-fact count | `[EVAL]` |
| End-to-end latency (audio → voice dispatch) | `[EVAL]` |

## Limitations & next steps

This is a hackathon prototype, not a certified operational product. The scenario is scripted (five prerecorded messages, plus radio-degraded variants); real fireground audio, per-service lexicons, and validation with actual fire officers are the immediate next steps — followed by LoRA adaptation on real corpus data with honest base-vs-adapted evaluation. The architecture was built so those corrections land in prompts and schemas, not in a rebuild.

> *We are not adding another sensor to the fireground. We are unlocking the sensor that was already there: every firefighter.*
