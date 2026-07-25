# BLAZE — Roadmap & Kanban process

Board: **GitHub Project v2 "BLAZE — Gemma 4 Hackathon"** on this repo. Every task is a GitHub issue with owner, workstream, phase, priority, allowed directories and acceptance criteria.

## Team

| GitHub | Role | Workstream |
|---|---|---|
| @aminssutt | AI agentique — 5 Gemma agents, vLLM/NVIDIA, STT, eval + orchestrator/state machine | `workstream:ai` |
| @selyan-mhli | Backend — FastAPI, SSE, data adapters, routing, TTS, Docker, offline | `workstream:platform` |
| @six-16 | Frontend — control-room UI, map, approval UX, docs, pitch, video | `workstream:product` |

## Working agreement (zero-conflict rules)

1. **One owner per directory** — see `.github/CODEOWNERS`. Never edit a directory you don't own without talking to its owner first.
2. **No direct push to `main`.** One feature branch per issue: `ai/<issue>-<name>`, `platform/<issue>-<name>`, `product/<issue>-<name>`, `integration/<name>`.
3. **PR = merge ticket.** Reviews are *not required* — you self-merge as soon as CI-less sanity checks pass. Exception: any PR touching `contracts/` or `agents/common/` requires review by **all three**.
4. `contracts/` is **frozen after Phase 0**. Frontend builds against `contracts/mocks/demo_event_stream.jsonl`; agents build against frozen schemas and mocked tools; backend exposes mock-compatible endpoints before real integration.
5. No broad formatting/dependency changes outside an issue's scope. Scoped dependency files per area (no single shared requirements file).
6. Integration happens at planned checkpoints (Phase 2 issues), not by continuous ad-hoc merging.

## Phases

### Phase 0 — Unblock & freeze (finish FIRST, fast)
Scaffold ✔ (this commit) · frozen contracts · mock event stream · audio conversion (m4a → clean + radio-degraded WAV) · env prerequisites verified (Gemma 4 access, NVIDIA/vLLM hello-world, faster-whisper, Piper FR) · NASA FIRMS key · demo bounding box.

### Phase 1 — Parallel build (everyone independent)
- **AI**: inference client, STT service, 5 agents against mocked tools, eval dataset.
- **Platform**: FastAPI, SSE, state-machine-compatible endpoints, all data adapters + caches, routing graph, approval API, Piper TTS, Docker.
- **Product**: full control-room UI against the mock stream — map, timeline, event cards, plan view, safety panel, approval workflow, dispatch, NVIDIA metrics.

### Phase 2 — Integration (strict order)
1. STT → Radio Intelligence
2. Tool adapters → Situation Context
3. Radio events + context → Tactical Planning
4. Draft plan → Safety Critic
5. Safety Critic → human approval
6. Approved plan → Dispatch Agent
7. Dispatch text → TTS
8. Backend events → frontend
9. Offline/cached mode
10. First complete end-to-end demo

### Phase 3 — Stabilization & submission
Deterministic reset · repeated 5-audio runs · all fallbacks tested · measured NVIDIA metrics · README/architecture diagram · Kaggle write-up finalized · demo script · **backup video** · pitch rehearsal · submission checklist.

### Buffer — feature freeze
Only: bug fixes, demo reliability, copy cleanup, performance measurements, video, rehearsal.

## Merge order

scaffold+contracts → mock stream → independent workstreams → backend mock endpoints → agents on mocked tools → frontend on backend events → real data adapters → approval-to-dispatch → offline/fallback → demo stabilization.

## Fallback hierarchy

| Level | Trigger | Fallback |
|---|---|---|
| 0 | — | Radio audio, local STT, live local Gemma 4/vLLM, live+cached tools, local TTS |
| 1 | External API outage | Cached weather/elevation/FIRMS/cadastre/OSM — Gemma reasoning stays real |
| 2 | STT instability | Clean audio → then reference transcript (labeled fallback) |
| 3 | TTS instability | Display text + pre-generated WAV |
| 4 | Inference instability | Restart vLLM → smaller Gemma 4 checkpoint → precomputed agent events (disclosed) → backup video |

## Definition of done (core demo)

Five audios load and transcribe locally · scenario order preserved · Gemma 4 structures radio events with corrections/confirmations · context tools return source-tagged data · versioned plan · Safety Critic finds a genuine risk · human approval mandatory · dispatch = approved actions only · Piper per-unit audio · streamed events in frontend · offline mode works · real vLLM/NVIDIA metrics shown · zero cloud LLM calls · reset & rerun works · backup video exists · public documented repo.

## Labels

`workstream:ai|platform|product|shared` · `phase:0-unblock|1-build|2-integration|3-demo|buffer` · `priority:p0..p3` · `contract-change` · `demo-blocker` · `offline` · `nvidia` · `agentic` · `speech` · `external-data` · `fallback`

Priorities: **P0** demo-blocking · **P1** core · **P2** important · **P3** optional (only after green end-to-end).
