# BLAZE — Turning Firefighter Radio Into a Live Operational Roadmap

> **Kaggle Technical Writeup — Google Gemma 4 Hackathon (Paris)**
> Track: **Autonomous Agents** · Additional submission: **NVIDIA GPU Challenge** (Gemma 4 deployed locally via vLLM)
>
> This is a **living document**, updated continuously during the hackathon. Rule: **no invented results, no invented benchmarks** — anything not yet measured is an explicit TODO.

---

## 1. Introduction

Wildfires are fought under extreme time pressure, degraded visibility, and unreliable communications. During an intervention, firefighters continuously describe the situation over radio: smoke color and density, wind shifts, blocked roads, remaining water, explosions, hazardous materials. This stream of voice reports is the richest real-time sensor on the fireground — and it is almost entirely unstructured.

The command post must mentally correlate dozens of fragmented messages, corrections, and confirmations while making decisions that put lives at risk. This is severe **cognitive overload**, and information is lost precisely when it matters most.

Two constraints shape any real solution:

- **Offline AI matters.** Firegrounds are frequently outside reliable network coverage; a cloud-dependent assistant fails exactly when it is needed.
- **Gemma 4 is relevant** because it is an open model that runs locally on a single NVIDIA GPU, supports function calling for real tool-driven agent workflows, and produces structured outputs reliable enough to build an auditable multi-agent pipeline around.

BLAZE (our project) turns firefighter radio communications into a live, structured, safety-reviewed operational roadmap — approved by a human commander and redistributed as personalized voice instructions — with every model running locally.

## 2. Problem Statement

The current workflow at a wildfire command post:

- **Radio communications are fragmented.** Multiple units report over shared channels in short, noisy, partially overlapping messages. A single message may contain a location, a hazard, a resource level, and an implicit request.
- **Information is lost.** Corrections ("the D17 is not fully blocked — light vehicles still pass") can silently invalidate earlier assumptions; under stress, they are easy to miss.
- **The command center must manually correlate everything**: radio reports, weather, terrain, road access by vehicle type, water points, building exposure, unit states. This correlation happens in the commander's head or on paper.
- **It is difficult to maintain a live operational picture.** There is no structured, versioned, evidence-linked representation of "what we currently believe about this incident" — and no systematic adversarial check of a plan's safety before it is transmitted.

## 3. Our Solution

BLAZE is an offline operational-intelligence system built as a real autonomous-agent workflow — not a transcription app, not a chatbot, not a static dashboard:

```text
Firefighter radio (5 prerecorded French messages)
        ↓
Local speech-to-text (faster-whisper)
        ↓
Gemma 4 Radio Intelligence Agent → structured operational events
        ↓
Gemma 4 Situation Context Agent + tools → context fusion (weather, terrain, buildings, roads, hotspots, units)
        ↓
Gemma 4 Tactical Fusion/Planning Agent → versioned operational roadmap
        ↓
Gemma 4 Safety Critic Agent → adversarial safety review (pass / revise / block)
        ↓
Human commander validation (approve / modify / reject) — hard gate
        ↓
Gemma 4 Dispatch Agent → one personalized instruction per unit
        ↓
Local text-to-speech (Piper) → personalized voice instructions
```

Key properties:

- Gemma 4 **interprets** field communications, **chooses tools**, **correlates** information, **proposes** a plan, **challenges** that plan, **waits for human approval**, and only then generates dispatch instructions.
- Corrections update the world model **without deleting the audit trail**.
- Every datum is provenance-labeled: `live_public`, `cached_public`, `seeded_demo`, `human_report`, or `model_inference`.
- The entire pipeline survives a network blackout.

## 4. System Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                          DEMO CONTROLLER                         │
│ Start incident · timeline · online/offline · clean/radio audio │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                  ┌────────────▼────────────┐
                  │ Audio Ingestion Service │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │ faster-whisper local STT│
                  └────────────┬────────────┘
                               │ transcripts
             ┌─────────────────▼─────────────────┐
             │ Gemma 4 Radio Intelligence Agent │
             └─────────────────┬─────────────────┘
                               │ RadioEvent[]
                               │
┌──────────────────────────────▼───────────────────────────────────┐
│          Gemma 4 Situation Context Agent + Tool Calls           │
│ Weather · elevation · FIRMS · cadastre · OSM · units/resources │
└──────────────────────────────┬───────────────────────────────────┘
                               │ SituationSnapshot
             ┌─────────────────▼─────────────────┐
             │ Gemma 4 Tactical Fusion/Planning │
             └─────────────────┬─────────────────┘
                               │ DraftTacticalPlan
             ┌─────────────────▼─────────────────┐
             │     Gemma 4 Safety Critic Agent  │
             └─────────────────┬─────────────────┘
                               │ SafetyReview
                  ┌────────────▼────────────┐
                  │ Human Approval Gate     │
                  │ Approve/Modify/Reject   │
                  └────────────┬────────────┘
                               │ ApprovedPlan
             ┌─────────────────▼─────────────────┐
             │       Gemma 4 Dispatch Agent      │
             └─────────────────┬─────────────────┘
                               │ DispatchInstruction[]
                  ┌────────────▼────────────┐
                  │ Piper local TTS         │
                  └────────────┬────────────┘
                               │
           Simulated radio endpoints for Alpha/Bravo/Charlie
```

Components:

- **Frontend**: Next.js (App Router) — single desktop control-room view: header/status, tactical map, radio timeline, structured-event panel, agent/tool trace, tactical roadmap, Safety Critic panel, approval controls, per-unit dispatch with TTS playback, NVIDIA metrics panel.
- **Backend**: FastAPI (Python) — deterministic orchestrator owning a 15-state incident state machine (`IDLE` → … → `DISPATCHED`/`COMPLETED`/`FAILED_WITH_FALLBACK`), event streaming (SSE) with a single event envelope, Tool Execution Layer (allowlist + validation + audit), Human Approval Gate API, plan versioning.
- **Gemma 4 + vLLM + NVIDIA GPU**: one local Gemma 4 deployment serving all five agents (separate prompts/roles), with measured inference metrics.
- **Speech-to-text**: faster-whisper, local, French language hint, concurrent transcription of the five audios.
- **Text-to-speech**: Piper with a downloaded French voice, one WAV per unit.
- **Map**: tactical map rendering seeded scenario geometry plus cached cadastral/OSM layers.
- **Context data**: Open-Meteo (weather, elevation), NASA FIRMS (hotspots), Cadastre Etalab (buildings), OSM/Overpass (roads/assets), seeded units/resources, local deterministic routing graph.
- **Agents**: five specialized Gemma 4 agents (Section 5).

A deliberate architectural rule: **deterministic services** (audio ingestion, STT, tool execution, approval gate, TTS) are never presented as LLM agents, and **agents never execute code** — they propose tool calls which the deterministic layer validates against an allowlist.

- TODO: screenshot — control-room overview
- TODO: screenshot — agent/tool trace during a live run
- TODO: final architecture diagram image (if it diverges from the ASCII above)

## 5. Autonomous Agents

Five specialized Gemma 4 agents share one local vLLM deployment but have separate prompts, inputs, outputs and responsibilities.

### 5.1 Radio Intelligence Agent

- **Purpose**: turn raw French radio transcripts into structured operational events.
- **Inputs**: raw transcript, audio metadata, known unit names, firefighter lexicon, recent transcript context.
- **Outputs**: `RadioEvent[]` with extraction confidence, uncertainties, proposed tool calls, and the original evidence span.
- **Reasoning**: identifies the speaking unit; extracts locations, hazards, resources; detects **negation, correction and uncertainty**; distinguishes reported vs. inferred vs. confirmed facts. Must not plan.
- **Tools**: proposes tool calls only — never executes them.
- **Implementation status**: TODO
- **Current limitations**: TODO

### 5.2 Situation Context Agent

- **Purpose**: assemble one provenance-labeled `SituationSnapshot` of the incident area.
- **Inputs**: incident coordinates/bounding box, unit/resource state, tool catalog, latest cached and live tool results.
- **Outputs**: `SituationSnapshot`, tool-call trace, missing-information list, data provenance.
- **Reasoning**: decides which territorial/environmental tools are useful; normalizes results; marks source, timestamp and staleness; separates real public data from seeded demo data. Must not issue orders.
- **Tools**: weather, elevation, FIRMS hotspots, cadastre, OSM assets, units/resources.
- **Implementation status**: TODO
- **Current limitations**: TODO

### 5.3 Tactical Fusion and Planning Agent

- **Purpose**: correlate radio events with territorial context into a versioned draft tactical plan.
- **Inputs**: ordered `RadioEvent[]`, `SituationSnapshot`, unit/resource state, road graph, existing plan version.
- **Outputs**: `DraftTacticalPlan` — summary, objectives, unit-specific actions with evidence and confidence, rejected options, assumptions, uncertainties.
- **Reasoning**: updates incident state; resolves corrections without deleting history; flags contradictions; identifies units/infrastructure at risk; marks actions requiring human approval. Must not dispatch.
- **Tools**: deterministic vehicle-aware routing and resource tools.
- **Implementation status**: TODO
- **Current limitations**: TODO

### 5.4 Safety Critic Agent

- **Purpose**: adversarially attack the draft plan before any human sees it.
- **Inputs**: draft plan, situation snapshot, unit/resource state, safety rules, evidence/uncertainty list.
- **Outputs**: `SafetyReview` — status `pass` / `revise` / `block`, critical objections, required changes, required confirmations.
- **Reasoning**: verifies retreat options per unit, vehicle/road compatibility, water/visibility constraints; flags stale information, single-weak-source actions, unconfirmed hazardous materials, radio-vs-external-data contradictions. Never replaces the human commander.
- **Tools**: rule checks against seeded safety rules; no dispatch capability.
- **Implementation status**: TODO
- **Current limitations**: TODO

### 5.5 Dispatch Agent

- **Purpose**: convert the **approved** plan into one concise, unambiguous message per unit, suitable for TTS.
- **Inputs**: approved plan, operator modifications, unit list, unit-specific missions, radio constraints.
- **Outputs**: `DispatchInstruction[]` with priority, acknowledgement-required flag, TTS-ready text.
- **Reasoning**: only rephrases the approved plan per unit; preserves critical numbers, route names and restrictions. **Cannot run before human approval; cannot add actions absent from the approved plan.**
- **Tools**: none (text generation constrained to approved content).
- **Implementation status**: TODO
- **Current limitations**: TODO

## 6. Gemma 4 Usage

- **Why Gemma?** Open weights, deployable locally on a single NVIDIA GPU, with native function-calling support ([Gemma 4 function calling docs](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)) — the prerequisite for a genuine tool-driven agent workflow rather than a prompt-only chatbot.
- **Why local?** The fireground has no reliable connectivity. A cloud LLM would fail exactly when the system is needed. Local deployment also gives predictable latency, zero data exfiltration, and lets us prove "cloud LLM calls = 0" live, including during a staged network blackout.
- **Why function calling?** All five agents interact with the world exclusively through proposed tool calls validated by a deterministic execution layer. Function calling gives us structured, auditable, allowlisted actions instead of free-text side effects.
- **Serving**: one local Gemma 4 deployment via vLLM ([vLLM Gemma 4 recipe](https://docs.vllm.ai/projects/recipes/en/stable/Google/Gemma4.html)), shared by the five agents with separate prompts. Exact checkpoint chosen after checking GPU memory: TODO (model ID + why).
- **How prompts evolved**: TODO — document iterations per agent (initial prompt → observed failure → revision).
- **How context evolved**: TODO — what each agent actually receives in context and how that changed.
- **How JSON extraction works**: agents must emit outputs conforming to frozen contracts (`RadioEvent`, `SituationSnapshot`, `DraftTacticalPlan`, `SafetyReview`, `DispatchInstruction`); validation + repair strategy: TODO (describe actual implementation: schema validation, retry/repair loop, failure rates).
- **How tools are selected**: agents receive a tool catalog and propose `ToolRequest`s with a stated reason; the Tool Execution Layer validates arguments against the allowlist. Observed selection quality: TODO.
- **How hallucinations are reduced**: structured outputs with mandatory evidence spans (extractions must cite transcript text); provenance labels; the Safety Critic flags claims relying on a single weak source; evaluation counts unsupported facts. Measured results: TODO.
- **How uncertainty is handled**: explicit `confidence`, `confirmation_status` (reported / inferred / confirmed), and `uncertainties` fields flow from extraction through planning to the human approval screen. Examples from real runs: TODO.

## 7. NVIDIA Integration

Gemma 4 is deployed locally on NVIDIA hardware through **vLLM** (the accepted inference stack we chose as default). The demo UI exposes only **real measured** inference information.

| Metric | Value |
|---|---|
| GPU (detected name) | TODO |
| CUDA / driver | TODO |
| Inference engine | vLLM (version: TODO) |
| Model identifier | TODO |
| Concurrent inference (max concurrent agent calls) | TODO |
| Per-request Gemma latency | TODO |
| End-to-end latency (audio → dispatch) | TODO |
| Tokens/sec | TODO (when available) |
| GPU memory usage | TODO |
| Cloud LLM calls | 0 (by design — verified live: TODO) |
| Offline execution | Full pipeline under network blackout: TODO (verified) |

**Why NVIDIA is important**: the entire value proposition is on-site inference — five agents making multiple concurrent calls over a three-minute incident, plus concurrent STT, on one GPU at the edge. TODO: measured evidence of concurrency benefit.

We do **not** claim TensorRT-LLM, Dynamo, NIM, quantization or speedups unless actually implemented and measured. Currently: none of these are implemented.

## 8. Engineering Decisions

Each entry explains **why**. This list grows during the hackathon.

1. **vLLM as the default inference engine.** Accepted NVIDIA stack for the GPU challenge, first-class Gemma 4 support, efficient concurrent serving for five agents sharing one deployment, and exposed metrics. Alternatives (TensorRT-LLM, NIM, Dynamo) were deferred: integration cost during a short hackathon vs. no demo-blocking benefit.
2. **One shared Gemma 4 deployment, five agent roles.** Separate prompts/contracts per agent give real specialization and auditability without the GPU memory cost of five model instances.
3. **faster-whisper for STT.** Local, no API key, fast enough for concurrent transcription of five audios, French support, robust on radio-degraded audio. Not a Gemma agent — transcription must never invent operational facts.
4. **Piper for TTS.** Local, no API key, downloadable French voice, one WAV per unit, works offline; text fallback if synthesis fails.
5. **Agents vs. deterministic services.** Audio ingestion, STT, tool execution, the approval gate and TTS are deterministic services. Reason: honesty (don't misrepresent services as agents), testability, and safety (LLMs propose; a validated allowlisted layer executes).
6. **Deterministic backend orchestrator + explicit 15-state state machine.** Reason: the incident lifecycle must be auditable and demo-reproducible; an LLM orchestrator would add nondeterminism with no benefit.
7. **Deterministic local routing graph instead of a live routing API.** A small seeded graph (D17, North Access, Forest Track 5, Water Point 2, Hangar Zone, Command Post) with vehicle-type awareness is reliable offline and sufficient to demonstrate vehicle-specific restriction reasoning.
8. **Frozen contracts + mock event stream before parallel work.** Three developers build in parallel (agents / backend / frontend) against frozen JSON contracts and `/contracts/mocks/demo_event_stream.jsonl`, so the frontend never waits for the backend, and agents never wait for real tools.
9. **Cache-first external data.** Every public API response used by the scenario is cached; the demo never depends on conference Wi-Fi.
10. **Hard human approval gate in the state machine.** Approval is not a UI convention — the `AWAITING_HUMAN_APPROVAL` state makes dispatch structurally impossible before an explicit decision.
11. TODO — decisions made during the build ("we initially planned X, switched to Y because…").

## 9. Datasets

| Dataset | Purpose | Source | License | How used | Why selected / cached |
|---|---|---|---|---|---|
| Five French radio audio files (clean + radio-degraded versions, `/data/audio/`) | Demo input: the scripted incident | Created by the team | Ours (repo license) | Ingested, transcribed, driven by scenario timestamps | Reproducible, controlled scenario; radio-degraded default proves robustness; clean fallback for reliability |
| Reference transcripts + expected structured outputs | STT/extraction evaluation ground truth and emergency fallback | Created by the team | Ours | Evaluation runner; labeled fallback | No invented accuracy numbers — measured against ground truth |
| Seeded scenario data (`/data/scenario/`: units, resources, roads, incidents, safety rules) | Firefighter unit/resource state and safety rules | Created by the team, labeled `seeded_demo` | Ours | Loaded by backend; consumed by agents and map | No public real-time API exposes live firefighter staffing/vehicle state — simulated by design and always labeled |
| Cadastre Etalab GeoJSON (clipped: `batiments`, optionally `parcelles`) | Building exposure around the hangar zone | cadastre.data.gouv.fr | Open License (Etalab) | Clipped/simplified before the event; rendered on map; used by context agent | Authoritative French open data, no key; cached because demo must be offline. No owner data used |
| OSM/Overpass extract (roads, tracks, water points, campings, assets) | Road network and critical assets | OpenStreetMap | ODbL | Cached GeoJSON; map + context agent | Best open coverage of roads/assets; cached to avoid live Overpass dependency during the pitch |
| Evaluation set (5 demo messages + ≥20 additional test messages: negations, corrections, vehicle restrictions, ambiguous numbers, missing speaker, contradictions, confirmed vs. unconfirmed) | Measure extraction quality | Created by the team | Ours | Evaluation runner (Section 13) | Covers the exact linguistic phenomena the demo depends on. Status: TODO |

## 10. APIs

| API | Purpose | Request | Response | Offline fallback | Why chosen |
|---|---|---|---|---|---|
| **Open-Meteo Weather** | Wind, humidity, temperature for the incident bounding box | HTTP GET, coordinates + variables; **no key** | JSON: temperature, humidity, wind speed/direction/gusts, precipitation, timestamp | Cached scenario response (`cached_public`) | No key, reliable, exactly the fields wildfire propagation reasoning needs |
| **Open-Meteo Elevation** | Terrain elevation (90 m model); local slope derived from nearby points | HTTP GET, coordinate list; **no key** | JSON elevations | Cached values (`cached_public`) | Fastest integration path for terrain; no key |
| **NASA FIRMS Area API** | Active-fire hotspots for a predefined bounding box / short time range | HTTP GET with free `MAP_KEY` | CSV/JSON hotspot list | Cached valid response; FIRMS unavailability never blocks the demo | Authoritative satellite fire detection; free key |
| **Overpass API (OSM)** | One-time extraction of roads/assets | Overpass QL; **no key** | GeoJSON-convertible OSM data | Pre-extracted local GeoJSON; no live dependency during pitch | Standard open access to OSM features |
| **Cadastre Etalab** | One-time download of commune buildings/parcels | Public file download; **no key** | GeoJSON | Local clipped files | Official French open cadastral geometry |
| **Local routing tool** (internal, deterministic) | Vehicle-aware route selection | vehicle type, blocked/restricted edges, danger polygons, origin, destination | Selected route, rejected routes, ETA, reason, vehicle compatibility | Fully local by construction | Offline-reliable; demonstrates vehicle-specific reasoning without an external routing stack |

All external calls go through the Tool Execution Layer: argument validation, allowlist, timeouts, cache fallback, provenance recording (`source_type`, `retrieved_at`, `is_cached`, `staleness_seconds`).

## 11. Challenges

Chronological log — only real challenges we actually hit, with how each was solved.

- TODO — populated during the build. Candidate areas to watch: radio-degraded audio STT quality, agent prompt engineering (corrections/negations), JSON schema conformance and repair, vLLM GPU memory vs. checkpoint choice, concurrent STT + agent inference on one GPU, event-stream synchronization, frontend/backend integration, offline-mode caching completeness.

## 12. Demo Scenario

Full script with narration in [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md). Step-by-step:

1. **Initial state** — Alpha 3 (CCF, 65% water) en route to Sector B12 via D17; Bravo 2 (recon); Charlie 1 (light vehicle); D17 open; Gemma 4 + vLLM live on NVIDIA.
2. **Start incident** — five concurrent local transcriptions + parallel context tool collection.
3. **Audio 1 (Alpha 3)** → Gemma extraction: dense smoke near hangar; D17 blocked for CCF; explosions heard, **unconfirmed**.
4. **Audio 2 (Alpha 3)** → water 30%, visibility near zero → unit risk raised.
5. **Context correlation** → Situation Context Agent snapshot: wind/humidity, terrain, cadastral hangar, roads, water point, FIRMS hotspot (if cached), unit states — all provenance-labeled.
6. **Audio 3 (Bravo 2)** → field-reported wind shift toward south-east; D17 risk raised.
7. **Audio 4 (Charlie 1)** → **correction**: D17 open to light vehicles, closed to CCF; previous event corrected, not deleted; map restyles by vehicle type.
8. **Draft plan** → Tactical Planning Agent proposes; **Safety Critic identifies a real risk** (e.g. Alpha 3 water/visibility) → revision.
9. **Audio 5 (Bravo 2)** → explosions confirmed, possible gas cylinders → exclusion zone; final plan version.
10. **Approval** — commander reviews actions, evidence, uncertainties, safety review → clicks **Approve**.
11. **Voice dispatch** — Dispatch Agent generates one message per unit; Piper synthesizes and plays each (Alpha 3: retreat via North Access to Water Point 2, D17 forbidden to CCF; Bravo 2: distant recon, stay out of exclusion perimeter; Charlie 1: confirm D17 light-vehicle access).
12. **Network blackout** — everything keeps running locally; NVIDIA metrics panel shows measured values; cloud LLM calls = 0.

## 13. Results

**Measured values only. No number below may be filled in without a real measurement.**

| Metric | Value |
|---|---|
| Number of autonomous agents | 5 (Radio Intelligence, Situation Context, Tactical Planning, Safety Critic, Dispatch) |
| Number of supported tools | TODO (count from implemented allowlist) |
| Valid structured output rate | TODO |
| Correct unit extraction | TODO |
| Correct location/road extraction | TODO |
| Correction detection accuracy | TODO |
| Confirmation-status accuracy | TODO |
| Correct tool selection | TODO |
| Unsupported-fact / hallucination count | TODO |
| STT latency (per audio, concurrent batch) | TODO |
| Per-agent Gemma latency | TODO |
| Tokens/sec | TODO |
| End-to-end latency (start incident → dispatch audio) | TODO |
| Cloud LLM calls during demo | TODO (target and design: 0) |

Evaluation setup: the five demo messages plus at least 20 additional test messages covering negations, corrections, vehicle-specific restrictions, ambiguous numbers, missing speakers, contradictory reports, and unconfirmed vs. confirmed events. Runner status: TODO.

## 14. Future Work

Ideas deliberately out of hackathon scope (see also explicit non-goals in the roadmap):

- LoRA/QLoRA adaptation of Gemma 4 on synthetic firefighter radio traffic, with honest base-vs-adapted evaluation.
- Few-shot vs. adapted comparison on the evaluation set.
- Real OSRM routing over full OSM networks; local map tiles.
- EFFIS fire-danger layers and population-exposure layers (WorldPop).
- Audio denoising front-end and speaker diarization for overlapping transmissions.
- NVIDIA Dynamo / TensorRT-LLM optimization on top of vLLM, with measured comparisons.
- Multiple incident scenarios and longer multi-hour timelines.
- Acknowledgement tracking loop (units confirming receipt feeding back into the state machine).
- TODO — keep appending ideas we don't have time to implement.

---

*BLAZE is a hackathon prototype, not a certified operational product. Simulated data is labeled as such; the human incident commander always approves before dispatch. See [`SAFETY_AND_LIMITATIONS.md`](./SAFETY_AND_LIMITATIONS.md).*
