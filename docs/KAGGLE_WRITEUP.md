# BLAZE — Turning Firefighter Radio Into a Live Operational Roadmap

> **Kaggle Technical Writeup — Google Gemma 4 Hackathon (Paris)**
> Track: **Autonomous Agents** · Additional submission: **NVIDIA GPU Challenge** (Gemma 4 deployed locally via vLLM)
>
> Engineering log, kept in sync with the repository through PR #151.
> Rule held from the first commit: **no invented results, no invented benchmarks.** Every number in this document was produced by a command we can re-run.
>
> Short jury-facing version: [`KAGGLE_WRITEUP_SUBMISSION.md`](KAGGLE_WRITEUP_SUBMISSION.md).

---

## 1. Introduction

Wildfires are fought under extreme time pressure, degraded visibility and unreliable communications. During an intervention, firefighters describe the situation continuously over radio: smoke colour and density, wind shifts, blocked roads, remaining water, explosions, hazardous materials. That stream of voice reports is the richest real-time sensor on the fireground — and it is almost entirely unstructured.

The context is not theoretical. France burned **44,000 hectares in 2026**, a record reached by **mid-July**, after **12,500 fire starts** since January — two thirds of the catastrophic 2022 season, before the peak of summer ([Franceinfo](https://www.franceinfo.fr/faits-divers/incendie/les-incendies-ont-brule-au-moins-44-000-hectares-en-france-en-2026-et-128-personnes-ont-ete-interpellees-annonce-laurent-nunez-en-gironde_8118410.html), [Toute l'Europe](https://www.touteleurope.eu/environnement/feux-de-foret-plus-de-42-000-hectares-deja-brules-en-france-en-2026-un-record-a-la-mi-juillet/)). More fronts, same number of command officers.

The command post must mentally correlate dozens of fragmented messages, corrections and confirmations while making decisions that put lives at risk. That is severe **cognitive overload**, and information is lost precisely when it matters most.

Two constraints shape any real solution:

- **Offline AI matters.** Firegrounds are frequently outside reliable network coverage; a cloud-dependent assistant fails exactly when it is needed.
- **Gemma 4 is the enabler.** It is an open model that runs locally on a single NVIDIA GPU, supports native function calling for genuine tool-driven agent workflows, and produces structured output reliable enough to build an auditable multi-agent pipeline around.

BLAZE turns firefighter radio into a live, structured, safety-reviewed operational roadmap — approved by a human commander and redistributed as personalized voice instructions — with every model running locally.

## 2. Problem statement

The current workflow at a wildfire command post:

- **Radio communications are fragmented.** Multiple units report over shared channels in short, noisy, partially overlapping messages. One message can carry a location, a hazard, a resource level and an implicit request at once.
- **Information is lost.** Corrections — *"the D17 is not fully blocked, light vehicles still pass"* — silently invalidate earlier assumptions and are easy to miss under stress.
- **Correlation is manual.** Radio reports, weather, terrain, road access by vehicle type, water points, building exposure, unit states: all of it is fused in the commander's head or on paper.
- **There is no live operational picture.** No structured, versioned, evidence-linked representation of *"what we currently believe about this incident"* — and no systematic adversarial check of a plan's safety before it is transmitted.

## 3. Our solution

BLAZE is an offline operational-intelligence system built as a real autonomous-agent workflow — not a transcription app, not a chatbot, not a static dashboard:

```text
Firefighter radio (5 prerecorded French messages, clean + radio-degraded)
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
Human commander validation (approve / modify / reject) — HARD GATE
        ↓
Gemma 4 Dispatch Agent → one personalized instruction per unit
        ↓
Local text-to-speech (Piper) → personalized voice instructions
```

Key properties:

- Gemma 4 **interprets** field communications, **chooses tools**, **correlates** information, **proposes** a plan, **attacks** that plan, **waits for human approval**, and only then generates dispatch instructions.
- Corrections update the world model **without deleting the audit trail**.
- Every datum is provenance-labeled: `live_public`, `cached_public`, `seeded_demo`, `human_report` or `model_inference`.
- The entire pipeline runs under a network blackout — verified by a test that booby-traps the network (Section 13).

## 4. System architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                     DEMO / SESSION CONTROLLER                    │
│  Start incident · replay speed · online/offline · clean/radio    │
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
             │  Gemma 4 Radio Intelligence Agent │
             └─────────────────┬─────────────────┘
                               │ RadioEvent[]
┌──────────────────────────────▼───────────────────────────────────┐
│           Gemma 4 Situation Context Agent + Tool Calls           │
│  Weather · elevation · FIRMS · cadastre · OSM · units/resources  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ SituationSnapshot
             ┌─────────────────▼─────────────────┐
             │  Gemma 4 Tactical Fusion/Planning │
             └─────────────────┬─────────────────┘
                               │ DraftTacticalPlan
             ┌─────────────────▼─────────────────┐
             │     Gemma 4 Safety Critic Agent   │
             └─────────────────┬─────────────────┘
                               │ SafetyReview
                  ┌────────────▼────────────┐
                  │   HUMAN APPROVAL GATE   │
                  │  Approve/Modify/Reject  │
                  └────────────┬────────────┘
                               │ ApprovedPlan
             ┌─────────────────▼─────────────────┐
             │       Gemma 4 Dispatch Agent      │
             └─────────────────┬─────────────────┘
                               │ DispatchInstruction[]
                  ┌────────────▼────────────┐
                  │     Piper local TTS     │
                  └────────────┬────────────┘
                               │
           Simulated radio endpoints for Alpha 3 / Bravo 2 / Charlie 1
```

Components:

- **Backend** — FastAPI (Python). Deterministic orchestrator owning a **15-state incident state machine** (`IDLE`, `INGESTING_AUDIO`, `TRANSCRIBING`, `EXTRACTING_RADIO_EVENTS`, `COLLECTING_CONTEXT`, `BUILDING_SITUATION`, `DRAFTING_PLAN`, `SAFETY_REVIEW`, `AWAITING_HUMAN_APPROVAL`, `REVISING_PLAN`, `APPROVED`, `GENERATING_DISPATCH`, `DISPATCHED`, `COMPLETED`, `FAILED_WITH_FALLBACK`), SSE streaming on a single event envelope, Tool Execution Layer (allowlist + JSON-Schema validation + audit), Human Approval Gate API, plan versioning. Routers: `incident`, `audio`, `approval`, `dispatch`.
- **Frontend** — Next.js 16 (App Router), three operational views plus the public landing page (Section 4.1).
- **Gemma 4 + vLLM + NVIDIA GPU** — one local deployment serving all five agent roles, with measured inference metrics surfaced in the UI.
- **Speech-to-text** — faster-whisper, local, French language hint, concurrent transcription of the five audios.
- **Text-to-speech** — Piper with a downloaded French voice, one WAV per unit, text fallback if synthesis fails.
- **Map** — tactical map rendering seeded scenario geometry plus cached cadastral/OSM layers, per-vehicle D17 styling, exclusion perimeter and plan routes (PR #140).
- **Context data** — Open-Meteo (weather, elevation), NASA FIRMS (hotspots), Cadastre Etalab (buildings), OSM/Overpass (roads/assets), seeded units/resources, local deterministic routing graph.
- **Agents** — five specialized Gemma 4 agents (Section 5).

A deliberate architectural rule: **deterministic services** (audio ingestion, STT, tool execution, approval gate, TTS) are never presented as LLM agents, and **agents never execute code** — they propose tool calls which the deterministic layer validates against an allowlist.

### 4.1 The three operational views

The UI went through a full product pass between PR #129 and PR #151. What ships:

- **`/workflow`** (default, PR #133/#136/#141) — a live **pipeline graph**: services → the five Gemma agents → **HUMAN GATE** → dispatch/TTS, each node lighting up as the incident advances. Clicking a node raises an overlay with that node's **terminal** (what it received, what it emitted, in order) and its expert panel. The commander's aside — approval act + dispatch list — is always fully visible; only the dispatch list scrolls. Player controls (play/pause, reset, speed) sit in the header.
- **`/expert`** (PR #139/#147) — a grid of nine large title-only buttons, each opening a full-screen panel: *Radio feed, Structured events, Tactical map, Situation synthesis, Agent & tool trace, Tactical plan, Safety review, Commander decision, Dispatch*. This is the consultation view for someone who wants depth, not choreography.
- **`/settings`** (PR #138) — the machine and the model: a dated **installation record** (explicitly not live telemetry), **live NVIDIA telemetry** driven entirely by `metric.updated` events, and a **per-agent Gemma consumption** table (PR #134) derived from the reduced event stream.

Both operational views render from the **same incident store**. The stream source — mock replay or live SSE — is chosen in `lib/session`; the store never knows which, so every view behaves identically in both modes. The store is an external store consumed with `useSyncExternalStore`, and the frontend ships two headless verification scripts (`verify-store`, `verify-viewport`) run in CI-style before merge.

### 4.2 Deployment

The stack is one command:

```bash
docker compose up -d          # vLLM (GPU-reserved) → backend → frontend, health-gated in that order
```

- `vllm` reserves all NVIDIA devices, mounts a persistent HF cache and exposes `/health`; the backend's `depends_on` waits for that health check, so `/incident/start` can never run against a cold model server.
- `docker compose up -d backend frontend` alone runs the mock/offline mode (no GPU required) — that is how the frontend was built in parallel with the agents.
- **`docker-compose.vm.yml`** (PR #126) is the demo-box overlay for the L40S: host networking, backend installing `faster-whisper` with a persisted Whisper cache, `VLLM_BASE_URL=http://localhost:8000`. vLLM runs **natively** on the VM rather than in a container — a containerized second load would not fit the GPU — and host networking is also what the inference client's local-only guard expects.
- vLLM binds `0.0.0.0` by default in the compose service (PR #145) so containers on the box can reach it, with the provider firewall and `ufw` restricting inbound to docker subnets.

## 5. Autonomous agents

Five specialized Gemma 4 agents share one local vLLM deployment, with separate prompts, inputs, outputs and responsibilities. Prompts live in `inference/prompts/`.

### 5.1 Radio Intelligence Agent

- **Purpose** — turn raw French radio transcripts into structured operational events.
- **Inputs** — raw transcript, audio metadata, known unit names, firefighter lexicon, recent transcript context.
- **Outputs** — `RadioEvent[]` with extraction confidence, uncertainties, proposed tool calls, and the original evidence span.
- **Reasoning** — identifies the speaking unit; extracts locations, hazards, resources; detects **negation, correction and uncertainty**; distinguishes reported vs. inferred vs. confirmed facts. Does not plan.
- **Implementation** — `agents/radio_intelligence/`, PR #84, 23 tests. French system prompt with the firefighter lexicon (CCF, PC, VL, D17…) and explicit STT-noise normalization. Deterministic post-LLM guardrails: evidence spans must fuzzy-match the transcript (invented evidence caps confidence at 0.3 and raises an uncertainty), unknown units forced to `"unknown"`, `source_type` forced to `human_report`, corrections without a target resolved deterministically against recent context, final validation against the frozen `radio_event` schema.
- **Live behaviour** — measured on the L40S against the 27-message evaluation set: 100% schema-valid output, 96.6% unit accuracy, F1 1.00 on corrections (Section 13).

### 5.2 Situation Context Agent

- **Purpose** — assemble one provenance-labeled `SituationSnapshot` of the incident area.
- **Inputs** — incident coordinates/bounding box, unit/resource state, tool catalog, latest cached and live tool results.
- **Outputs** — `SituationSnapshot`, tool-call trace, missing-information list, data provenance.
- **Reasoning** — decides which territorial/environmental tools are useful; normalizes results; marks source, timestamp and staleness; separates real public data from seeded demo data. Does not issue orders.
- **Tools** — weather, elevation, FIRMS hotspots, cadastre, OSM assets, units/resources.
- **Implementation** — `agents/situation_context/`, PR #86, 7 tests. Two-phase design: guarded tool selection (hallucinated tool names discarded without execution, per-turn budget of 5 calls) then snapshot synthesis under a **provenance lock** — source labels are rewritten from the real `ToolResult`s, so the model cannot claim cached data is live (dedicated test). Tests run against the real committed cache data. Catalog names are bridged to the executor registry through `catalog_from_registry()`.

### 5.3 Tactical Fusion and Planning Agent

- **Purpose** — correlate radio events with territorial context into a versioned draft tactical plan.
- **Inputs** — ordered `RadioEvent[]`, `SituationSnapshot`, unit/resource state, road graph, existing plan version.
- **Outputs** — `DraftTacticalPlan`: summary, objectives, unit-specific actions with evidence and confidence, rejected options, assumptions, uncertainties.
- **Reasoning** — updates incident state; resolves corrections without deleting history; flags contradictions; identifies units and infrastructure at risk; marks actions requiring human approval. Does not dispatch.
- **Implementation** — `agents/tactical_planning/`, PR #85, 8 tests. Evidence IDs verified against real event/tool-call IDs (invented references removed and flagged); plan version, ID and timestamps generated by code, never by the model; append-only `PlanHistory` keeping every version immutable; `human_approval_required` forced `true` for high/critical actions; bounded tool loop (2 rounds) for `compute_route`. Plan intake is additionally validated against the frozen contract schema at the backend boundary (PR #128).

### 5.4 Safety Critic Agent

- **Purpose** — adversarially attack the draft plan before any human sees it.
- **Inputs** — draft plan, situation snapshot, unit/resource state, safety rules, evidence/uncertainty list.
- **Outputs** — `SafetyReview`: status `pass` / `revise` / `block`, critical objections, required changes, required confirmations.
- **Reasoning** — verifies retreat options per unit, vehicle/road compatibility, water and visibility constraints; flags stale information, single-weak-source actions, unconfirmed hazardous materials, radio-vs-external-data contradictions. Never replaces the human commander.
- **Implementation** — `agents/safety_critic/`, PR #87, 33 tests. **Hybrid architecture**: 8 deterministic rule checks in pure code (retreat routes, vehicle/road compatibility, 20%/35% water thresholds, visibility, 300 m hazmat perimeter, mandatory human approval, data staleness, single-weak-source) fused with an adversarial Gemma critique under a hard priority rule — a mechanical `fail` forces `revise`/`block` regardless of the LLM's opinion (anti-sycophancy test included), and an LLM outage degrades to rules-only with a `revise` floor.

### 5.5 Dispatch Agent

- **Purpose** — convert the **approved** plan into one concise, unambiguous message per unit, suitable for TTS.
- **Inputs** — approved plan, operator modifications, unit list, unit-specific missions, radio constraints.
- **Outputs** — `DispatchInstruction[]` with priority, acknowledgement-required flag, TTS-ready text.
- **Reasoning** — rephrases the approved plan per unit; preserves critical numbers, route names and restrictions. **Cannot run before human approval; cannot add actions absent from the approved plan.**
- **Implementation** — `agents/dispatch/`, PR #88, 9 tests. Hard authorization precondition: a `reject` decision (or a mismatched plan ID) raises **before any LLM call is made** — asserted by a test counting zero HTTP requests. Anti-invention guardrail: a closed vocabulary of scenario locations (from the seeded roads/resources data) is checked lexically; a route or destination absent from the approved action triggers bounded regeneration then a typed error. Acknowledgement forced for high/critical priorities; TTS-friendly phrasing rules ("CCF" → "camion-citerne").

## 6. Gemma 4 usage

**Why Gemma?** Open weights, deployable locally on a single NVIDIA GPU, with native function calling ([docs](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)) — the prerequisite for a genuine tool-driven agent workflow rather than a prompt-only chatbot. Operational radio traffic is sensitive data that a fire service cannot ship to a third-party API, and the fireground has no bandwidth to do so anyway. Open weights are not a preference here; they are the condition of existence.

**Why local?** The fireground has no reliable connectivity, so a cloud LLM fails exactly when the system is needed. Local deployment also gives predictable latency, zero data exfiltration, and lets us prove "cloud LLM calls = 0" live, including during a staged network blackout.

**Serving.** One local Gemma 4 deployment via vLLM ([recipe](https://docs.vllm.ai/projects/recipes/en/stable/Google/Gemma4.html)), shared by the five agents:

```bash
vllm serve google/gemma-4-E4B-it \
  --host 127.0.0.1 --port 8000 \
  --enable-auto-tool-choice \
  --tool-call-parser gemma4 \
  --reasoning-parser gemma4 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90
```

**Checkpoint choice.** `google/gemma-4-E4B-it` in **bf16, unquantized** — a mixture-of-experts with ~4B active parameters, 15.18 GiB of measured weights. Full precision is a deliberate call: these outputs are safety-critical, so we keep the model exactly as trained rather than trading accuracy for VRAM we do not need. The `E2B` checkpoint (~6 GB) is the drop-in path for 8 GB cards — same client, one environment variable (`GEMMA_MODEL_ID`).

**Function calling.** All five agents interact with the world exclusively through proposed tool calls. Agents receive a tool catalog and emit `ToolRequest`s with a stated reason; the Tool Execution Layer (`backend/orchestrator/`, PR #79) validates arguments against per-tool JSON Schemas and an allowlist — an unknown or unavailable tool is never executed — and every request/result pair is audited against the frozen contracts. This is what turns "an LLM with a prompt" into an agent: Gemma decides that a reported wind shift justifies re-pulling weather and re-checking road access for a given vehicle type, and the decision is inspectable afterwards.

**Structured output.** All five agents call the shared client (`agents/common/inference_client.py`, PR #78) through `chat_structured()`: the request carries a `json_schema` response format enforced by vLLM **guided decoding**; the response is re-validated with `jsonschema` against the frozen contract; on failure a bounded **repair loop** (default 2 attempts) re-prompts with the exact validation error before raising a typed `StructuredOutputError`. Retries with exponential backoff cover timeouts and 5xx, never 4xx. Live rate on the evaluation set: **27/27 valid, zero repair failures**.

**Hallucination containment** is layered deterministic code around every LLM output: (1) evidence spans must fuzzy-match the source transcript or confidence is capped; (2) provenance labels are rewritten from real tool results; (3) plan evidence IDs are verified against real event/tool IDs; (4) dispatch messages are checked against a closed location vocabulary from the approved action; (5) the Safety Critic's mechanical rule failures override any LLM approval; (6) the evaluation runner counts unsupported facts. Prompts reduce error rates; code bounds them.

**Uncertainty handling.** Explicit `confidence`, `confirmation_status` (reported / inferred / confirmed) and `uncertainties` fields flow from extraction through planning to the human approval screen. Guardrail interventions — degraded evidence, unknown units, removed references — are themselves appended as uncertainties rather than silently dropped, so the commander sees where the system is unsure *and* where it corrected itself.

**Local-only guard.** Any non-localhost inference URL raises `RemoteInferenceBlockedError` unless a dev-only escape flag is set, and a shared `CallLog` counts `cloud_calls`, exposed live in the UI so the demo can assert it equals 0.

## 7. NVIDIA integration

Gemma 4 is deployed locally on NVIDIA hardware through **vLLM**. The demo UI exposes only **real measured** values — the collector (`inference/metrics/collector.py`) reads the GPU name from `nvidia-smi` (2 s timeout), the model id from the environment, per-request latency and tokens/s from the engine's own usage reporting, plus agent call count, peak concurrency and the cloud-call counter. Anything it did not measure is returned as `None` and rendered as `—`.

| Metric | Value (measured on our instance) |
|---|---|
| GPU | NVIDIA L40S — 46,068 MiB |
| Driver / CUDA | 580.126.09 / 13.0 |
| Machine | 12 CPU · 72 GiB RAM · 625 GiB disk |
| Inference engine | vLLM 0.25.1 |
| Model identifier | `google/gemma-4-E4B-it`, bf16, 8192 context |
| Model load | 15.18 GiB weights in 4.6 s |
| KV cache | 25.16 GiB → 920,621 tokens |
| Max concurrency at 8k context | ×112 |
| Single-stream generation | 100 output tokens in 1.92 s end-to-end ≈ 52 tok/s |
| Mean per-message extraction latency (live, guided decoding) | 7.2 s (p50 7.1 s, max 11.7 s) |
| STT (Whisper `small`, CPU int8) | 9.92 s audio → 2.61 s transcription (RTF 0.26) |
| Cloud LLM calls | 0 — enforced by the client guard |
| Offline execution | Full scenario completes with the network booby-trapped (Section 13) |

**Why the L40S — the sizing argument.** We sized the GPU on our real constraint, and it is not model size: it is **concurrency**. Five agents hit one server in parallel over a three-minute incident, plus concurrent STT. The weights are the model's knowledge; the **KV cache is its working memory**, and cache is what caps how many agents can think at once. A 24 GB card fits the weights and leaves almost nothing for cache. An H100 sells training bandwidth this workload never touches. The L40S at 48 GB gave us **25.16 GiB of measured cache — 920,621 tokens, ×112 concurrency at 8k** — for about a dollar an hour: the best usable-VRAM-per-dollar on the catalog, with headroom to grow the model or the context without changing a line of code.

**Why one deployment, five roles.** Five model instances would have cost five times the VRAM for zero added capability. vLLM's continuous batching lets the five agent roles share one deployment and one KV pool, which is exactly what the concurrency budget above buys.

**Why vLLM.** First-class Gemma 4 support (tool-call and reasoning parsers), guided decoding — which is what makes our structured contracts enforceable at generation time rather than hopefully parsed afterwards — efficient concurrent serving, and exposed metrics we can surface honestly. TensorRT-LLM, NIM and Dynamo comparisons sit in Future Work (Section 14) as measured optimizations on top of this baseline.

## 8. Engineering decisions

Each entry explains **why**.

1. **vLLM as the inference engine.** Accepted NVIDIA stack, first-class Gemma 4 support, guided decoding, efficient concurrent serving for five agents on one deployment, exposed metrics.
2. **One shared Gemma 4 deployment, five agent roles.** Separate prompts and contracts per agent give real specialization and auditability without paying VRAM five times.
3. **Full-precision bf16 weights.** Safety-critical outputs; we keep the model as trained and buy the VRAM instead. E2B is the documented path for 8 GB cards.
4. **faster-whisper for STT.** Local, no API key, fast enough for concurrent transcription of five audios, French support, robust on radio-degraded audio. Kept as a deterministic service — transcription must never invent operational facts.
5. **Piper for TTS.** Local, no API key, downloadable French voice, one WAV per unit, works offline, text fallback if synthesis fails.
6. **Agents vs. deterministic services.** Audio ingestion, STT, tool execution, approval gate and TTS are services. Reason: honesty (never dress a service up as an agent), testability, and safety (LLMs propose; a validated allowlisted layer executes).
7. **Deterministic backend orchestrator + explicit 15-state machine.** The incident lifecycle must be auditable and demo-reproducible; an LLM orchestrator would add nondeterminism with no benefit.
8. **Deterministic local routing graph.** A seeded vehicle-aware graph (D17, North Access, Forest Track 5, Water Point 2, Hangar Zone, Command Post) is reliable offline and sufficient to demonstrate vehicle-specific restriction reasoning.
9. **Frozen contracts + mock event stream before parallel work.** Three developers built in parallel (agents / backend / frontend) against frozen JSON contracts and `/contracts/mocks/demo_event_stream.jsonl` — the frontend never waited for the backend, and the agents never waited for real tools.
10. **Cache-first external data.** Every public API response used by the scenario is cached; the demo never depends on conference Wi-Fi.
11. **Hard human approval gate in the state machine.** Approval is not a UI convention: `AWAITING_HUMAN_APPROVAL` makes dispatch structurally impossible before an explicit decision — the transition does not exist (state-machine test matrix, 41 tests, PR #73) — and the Dispatch Agent additionally refuses to make a single LLM call without an `approve` decision (PR #88).
12. **Hybrid Safety Critic (rules + LLM).** We considered a pure LLM critic and shipped a hybrid where 8 rules are deterministic code and the LLM can only add objections or escalate. An LLM can be talked out of an objection; a water-threshold check cannot (PR #87).
13. **Guardrails as post-processing, not prompt hopes.** Every agent pairs its prompt with deterministic post-LLM validation. Prompts reduce error rates; code bounds them.
14. **External store + `useSyncExternalStore` on the frontend** (no Redux/zustand). Replay timers live outside React; at ×5 speed a Context-based approach would re-render the whole tree several times per second (PR #82). The mock player and the real SSE source share one `EventSource` adapter interface, so integration swapped the source, not the consumers (PR #117 hardened the viewport check so it can no longer pass on an empty control room).
15. **Pinned `av==13.1.0` for faster-whisper decoding.** The newest PyAV wheel was refused by Windows Smart App Control on the dev machine; the established wheel loads fine. Documented in the STT requirements (PR #69).
16. **vLLM served natively on the demo VM, containerized elsewhere** (PR #126). A containerized second model load would not fit the GPU next to the native server, and host networking is what the client's local-only guard expects. vLLM binds `0.0.0.0` so sibling containers can reach it, with the firewall restricting inbound to docker subnets (PR #145).
17. **`/workflow` as the default view** (PR #133/#136/#137). The pipeline graph with click-to-open agent terminals shows the agent workflow itself — the thing the track is judged on — instead of hiding it behind a dashboard. `/expert` keeps the full nine-panel depth for whoever wants it.
18. **Zero emoji in the product UI, human-gate buttons appearing only on hand-over** (PR #144). This is a command-post tool: the interface must read as instrumentation, and the approve/reject affordance must not exist visually until the system is actually asking for a decision.
19. **English locale for the product UI, French for the operational content.** The radio traffic, lexicon and prompts are French because the domain is; the interface is English so an international jury can read the trace live (PR #132).

## 9. Datasets

| Dataset | Purpose | Source | License | How used | Why selected / cached |
|---|---|---|---|---|---|
| Five French radio audio files, clean + radio-degraded (`/data/audio/`) | Demo input: the scripted incident | Created by the team | Ours (repo license) | Ingested, transcribed, driven by scenario timestamps | Reproducible, controlled scenario; radio-degraded default proves robustness; clean variant as fallback |
| Reference transcripts + expected structured outputs | STT/extraction ground truth and labeled fallback | Created by the team | Ours | Evaluation runner | No invented accuracy numbers — everything measured against ground truth |
| Seeded scenario data (`/data/scenario/`: units, resources, roads, incidents, safety rules) | Firefighter unit/resource state and safety rules | Created by the team, labeled `seeded_demo` | Ours | Loaded by backend; consumed by agents and map | No public API exposes live firefighter staffing or vehicle state — simulated by design and always labeled |
| Cadastre Etalab GeoJSON (clipped `batiments`, optionally `parcelles`) | Building exposure around the hangar zone | cadastre.data.gouv.fr | Open License (Etalab) | Clipped/simplified before the event; rendered on the tactical map; used by the context agent | Authoritative French open data, no key; cached because the demo must be offline. No owner data used |
| OSM/Overpass extract (roads, tracks, water points, campings, assets) | Road network and critical assets | OpenStreetMap | ODbL | Cached GeoJSON; map + context agent | Best open coverage of roads/assets; cached to remove any live Overpass dependency during the pitch |
| Evaluation set — 27 labeled messages (`data/evaluation/radio_messages.jsonl`) | Measure extraction quality | Created by the team | Ours | Evaluation runner (Section 13) | Covers the exact linguistic phenomena the demo depends on: negations, corrections, vehicle restrictions, ambiguous numbers, missing speaker, contradictions, confirmed vs. unconfirmed, noisy-STT variants |

## 10. APIs

| API | Purpose | Request | Response | Offline fallback | Why chosen |
|---|---|---|---|---|---|
| **Open-Meteo Weather** | Wind, humidity, temperature for the incident bounding box | HTTP GET, coordinates + variables; **no key** | JSON: temperature, humidity, wind speed/direction/gusts, precipitation, timestamp | Cached scenario response (`cached_public`) | No key, reliable, exactly the fields wildfire propagation reasoning needs |
| **Open-Meteo Elevation** | Terrain elevation (90 m model); local slope derived from nearby points | HTTP GET, coordinate list; **no key** | JSON elevations | Cached values (`cached_public`) | Fastest integration path for terrain; no key |
| **NASA FIRMS Area API** | Active-fire hotspots for a bounding box / short time range | HTTP GET with free `MAP_KEY` | CSV/JSON hotspot list | Cached valid response | Authoritative satellite fire detection; free key |
| **Overpass API (OSM)** | One-time extraction of roads and assets | Overpass QL; **no key** | GeoJSON-convertible OSM data | Pre-extracted local GeoJSON | Standard open access to OSM features |
| **Cadastre Etalab** | One-time download of commune buildings/parcels | Public file download; **no key** | GeoJSON | Local clipped files | Official French open cadastral geometry |
| **Local routing tool** (internal, deterministic) | Vehicle-aware route selection | vehicle type, blocked/restricted edges, danger polygons, origin, destination | Selected route, rejected routes, ETA, reason, vehicle compatibility | Fully local by construction | Offline-reliable; demonstrates vehicle-specific reasoning without an external routing stack |

All external calls go through the Tool Execution Layer: argument validation, allowlist, timeouts, cache fallback, provenance recording (`source_type`, `retrieved_at`, `is_cached`, `staleness_seconds`).

## 11. Challenges

Chronological log — real challenges, with how each was solved.

1. **Windows Smart App Control blocked PyAV DLLs** (STT hello-world, PR #69). The latest `av` 18.x wheel — unsigned and too recent to have cloud reputation — was refused by the OS. Solved by pinning `av==13.1.0` and documenting it in requirements so it does not resurface on another machine.
2. **Whisper `small` mangles domain proper nouns on radio audio.** Real transcription rendered "D17" as *"dédicite"* and "hangar" as *"Jean-Garre"* — measured on our own recordings. Mitigations shipped: the Radio Intelligence prompt normalizes noisy mentions with reduced confidence and keeps the original in `uncertainties`, and the STT service uses faster-whisper's `initial_prompt` seeded with the firefighter lexicon (`speech/stt/compare_initial_prompt.py` measures the two variants side by side).
3. **Duplicate work on ticket #21.** A human teammate and a Claude agent implemented the FastAPI scaffold concurrently (PRs #67 and #68). The agent rebased its additions onto the human's merged conventions, and the team adopted a rule: claim a ticket by commenting on the issue before starting.
4. **Speaker labeling error found by listening to the real audio.** The roadmap assumed Audio 4 was spoken by Charlie 1; the recording is Alpha 3. The manifest was corrected against the recordings rather than the spec (PR #64, propagated to the mock stream in PR #97) — ground truth beats documentation.
5. **A real bug caught by tests before merge.** The Safety Critic's water-refill check initially counted a *retreat* to Water Point 2 as a *refill plan*; the suite exposed it and it was fixed pre-merge (PR #87).
6. **The strict evidence matcher penalizes correct paraphrases.** Our unsupported-fact metric compares extracted facts to gold text by token overlap, so a correct fact worded differently is scored as unsupported — which is why that row reads 51% while unit accuracy reads 96.6%. We report the measured number as-is and are moving the matcher to semantic comparison; inflating it by loosening the threshold would defeat the purpose of having the metric.
7. **The viewport check passed on an empty control room** (PR #117). The frontend layout guard was asserting geometry on a page that had not received any events, so it could not fail. Fixed by requiring populated state before the assertion — a green check that cannot go red is worse than no check.
8. **The provider firewall blocked inbound traffic to the VM** (PR #145). vLLM bound to `127.0.0.1` was unreachable from sibling containers on the demo box. Fixed by binding `0.0.0.0` in the compose service while `ufw` restricts inbound to docker subnets — reachable where it must be, closed everywhere else.

## 12. Demo scenario

Full script with narration in [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md). Step by step:

1. **Initial state** — Alpha 3 (CCF, 65% water) en route to Sector B12 via the D17; Bravo 2 (recon); Charlie 1 (light vehicle); D17 open; Gemma 4 + vLLM live on the NVIDIA box.
2. **Start incident** — five concurrent local transcriptions and parallel context tool collection.
3. **Audio 1 (Alpha 3)** → Gemma extraction: dense smoke near the hangar; D17 blocked for CCF; explosions heard, **unconfirmed**.
4. **Audio 2 (Alpha 3)** → water at 30%, visibility near zero → unit risk raised.
5. **Context correlation** → Situation Context snapshot: wind and humidity, terrain, cadastral hangar, roads, water point, FIRMS hotspot, unit states — all provenance-labeled.
6. **Audio 3 (Bravo 2)** → field-reported wind shift toward the south-east; D17 risk raised.
7. **Audio 4 (Alpha 3)** → **correction**: D17 open to light vehicles, closed to CCF. The previous event is corrected, not deleted; the map restyles the road by vehicle type.
8. **Draft plan** → Tactical Planning proposes; the **Safety Critic identifies a real risk** (Alpha 3's water and visibility) → revision.
9. **Audio 5 (Bravo 2)** → explosions confirmed, possible gas cylinders → exclusion perimeter; final plan version.
10. **Approval** — the commander reviews actions, evidence, uncertainties and the safety review, then clicks **Approve**.
11. **Voice dispatch** — the Dispatch Agent writes one message per unit and Piper speaks each one (Alpha 3: retreat via North Access to Water Point 2, D17 forbidden to CCF; Bravo 2: distant recon, stay outside the exclusion perimeter; Charlie 1: confirm D17 light-vehicle access).
12. **Network blackout** — everything keeps running locally; the telemetry panel shows measured values; cloud LLM calls = 0.

## 13. Results

**Measured values only.**

| Metric | Value |
|---|---|
| Autonomous agents | 5 — Radio Intelligence, Situation Context, Tactical Planning, Safety Critic, Dispatch |
| Allowlisted tools | 7 registered in the Tool Execution Layer: `get_weather`, `get_elevation`, `compute_route`, `get_firms`, `get_cadastre`, `get_osm`, `get_resources` |
| Automated tests | **300 Python test functions** across agents, tools, state machine, executor, streaming, eval harness (per-PR pytest output in each PR body), plus two headless frontend verification scripts |
| Valid structured-output rate (live Gemma) | **100%** — 27/27 messages, zero repair-loop failures |
| Unit accuracy (live) | **96.6%** |
| Correction detection (live) | **F1 1.00** |
| Location extraction (live) | 65.5% |
| Unsupported-fact rate (strict token-overlap vs gold) | 51% — the matcher scores any paraphrase of a correct fact as unsupported (Challenge #6) |
| Mean extraction latency (live, guided decoding) | 7.2 s/message — p50 7.1 s, max 11.7 s |
| STT latency — 9.92 s radio audio, Whisper `small`, CPU int8 | 2.61 s transcription (RTF 0.26), 1.48 s model load from cache, fully offline (PR #69) |
| Cloud LLM calls during the eval run | **0**, client-enforced |
| Offline end-to-end run | **Passes** — `backend/tests/test_offline.py` |

**The offline test is the claim's proof** (PR #142). It monkey-patches `urllib.request.urlopen`, `requests.get/post/request` to raise on any outbound attempt, then: every adapter (weather, elevation, FIRMS, OSM, cadastre) returns `status: success` with `source_type: cached_public`, the resources store returns `seeded_demo`, all **five audios** ingest through the real file-only ingestion path (`emitted: 5, errors: 0`), and a full `/incident/start` run reaches state `COMPLETED` at sequence **70** with `network_mode: offline`. "It works offline" is a passing test, not a sentence in a slide.

**Evaluation setup.** 27 labeled French radio messages (5 demo + 22 adversarial: negations, corrections, vehicle restrictions, ambiguous numbers, missing speakers, contradictions, confirmed vs. unconfirmed, noisy-STT variants) with a pluggable runner producing `metrics.json` plus a markdown table (`inference/evaluation/runner.py`, PR #81). The runner is the **only** source allowed to populate the accuracy rows above.

## 14. Future work

Scoped beyond the hackathon, in the order we would take them:

- Semantic evidence matching to replace the strict token-overlap scorer, so the unsupported-fact metric measures meaning rather than wording.
- Validation with SDIS command officers, and per-service lexicons and unit-naming conventions.
- Real fireground audio: accents, cross-talk, PTT clipping — plus audio denoising and speaker diarization for overlapping transmissions.
- LoRA/QLoRA adaptation of Gemma 4 on a real firefighter radio corpus, with honest base-vs-adapted evaluation on the same set, and a few-shot vs. adapted comparison.
- NVIDIA TensorRT-LLM / Dynamo / NIM optimization on top of the vLLM baseline, with measured before/after on the same hardware.
- Real OSRM routing over full OSM networks; local map tiles.
- EFFIS fire-danger layers and population-exposure layers (WorldPop).
- Multiple concurrent incidents and multi-hour timelines.
- Acknowledgement tracking loop: units confirming receipt, feeding back into the state machine.

---

*BLAZE is a hackathon prototype, not a certified operational product. Simulated data is labeled as such; the human incident commander always approves before dispatch. See [`SAFETY_AND_LIMITATIONS.md`](./SAFETY_AND_LIMITATIONS.md).*
