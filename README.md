# BLAZE 🔥

**An offline operational-intelligence system that transforms fragmented firefighter radio communications and live territorial data into a structured, safety-reviewed action plan — approved by a human incident commander and redistributed as personalized voice instructions to field units.**

> Firefighters already describe the battlefield every second. BLAZE turns their voices into a live, structured and actionable operational roadmap.

Built for the **Paris Gemma 4 Hackathon** — primary track: **Autonomous Agents**, plus the **NVIDIA GPU Challenge** (Gemma 4 deployed locally through vLLM).

## What it does

```text
Five prerecorded radio messages
        ↓
Local speech-to-text (faster-whisper)
        ↓
Radio Intelligence Agent (Gemma 4)
        ↘
          Tactical Fusion & Planning Agent (Gemma 4)
        ↗
Situation Context Agent (Gemma 4) + territorial tools
        ↓
Safety Critic Agent (Gemma 4)
        ↓
Human commander approval  ← always mandatory
        ↓
Dispatch Agent (Gemma 4)
        ↓
Local text-to-speech (Piper)
        ↓
Personalized simulated radio messages for each unit
```

BLAZE is a **decision-support and communication system**, not an autonomous emergency commander. The human incident commander always approves, modifies, or rejects critical actions before dispatch. This is a hackathon prototype, not a certified operational product — see [docs/SAFETY_AND_LIMITATIONS.md](docs/SAFETY_AND_LIMITATIONS.md).

## Stack

| Layer | Tech |
|---|---|
| LLM | Gemma 4 — local, via **vLLM** on NVIDIA GPU (zero cloud LLM calls) |
| Agents | 5 specialized Gemma agents (Radio Intelligence, Situation Context, Tactical Planning, Safety Critic, Dispatch) |
| STT | faster-whisper (local, French) |
| TTS | Piper (local, French voice) |
| Backend | FastAPI + deterministic orchestrator/state machine + SSE event streaming |
| Frontend | Next.js control-room UI (tactical map, radio timeline, agent trace, approval gate) |
| Data | Open-Meteo, NASA FIRMS, Cadastre Etalab, OSM — all cacheable for full offline demo |

## Team & ownership

| Who | Workstream | Owns |
|---|---|---|
| [@aminssutt](https://github.com/aminssutt) | AI / Agents | `agents/`, `inference/`, `speech/stt/`, `backend/orchestrator/`, `backend/state/`, `scripts/ai/` |
| [@selyan-mhli](https://github.com/selyan-mhli) | Platform / Backend | `backend/api|streaming|loaders/`, `tools/`, `data/`, `speech/tts/`, `scripts/platform/`, `docker-compose.yml`, `.env.example` |
| [@six-16](https://github.com/six-16) | Product / Frontend | `frontend/`, `design/`, `demo/`, `docs/`, `scripts/product/`, `README.md` |

**No-conflict rules:** one owner per directory · no direct push to `main` · one branch per issue · everything merges through PRs (self-merge allowed, no approval required — except `contracts/`) · `contracts/` is **frozen** after Phase 0 and any change requires a PR reviewed by all three.

**Branch naming:** `ai/<issue>-<name>` · `platform/<issue>-<name>` · `product/<issue>-<name>` · `integration/<name>`

## Getting started

```bash
git clone https://github.com/aminssutt/Blaze.git
cd Blaze
cp .env.example .env   # fill in what you need (see docs/DATA_SOURCES.md)
```

Startup order (once implemented):

1. vLLM server with Gemma 4 (`scripts/ai/`)
2. Backend (`backend/` — FastAPI, port 8080)
3. Frontend (`frontend/` — Next.js, port 3000)

Frontend can run standalone against the mock stream: `contracts/mocks/demo_event_stream.jsonl`.

## Docs

- [Roadmap & kanban process](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Data sources & API keys](docs/DATA_SOURCES.md)
- [Safety & limitations](docs/SAFETY_AND_LIMITATIONS.md)
- [Kaggle write-up (live)](docs/KAGGLE_WRITEUP.md)
