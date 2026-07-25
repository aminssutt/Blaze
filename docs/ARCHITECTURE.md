# BLAZE — System Architecture

> **BLAZE** is an offline operational-intelligence system that transforms fragmented firefighter radio communications and live territorial data into a structured, safety-reviewed action plan, approved by a human incident commander and redistributed as personalized voice instructions to field units.

> **Human principle:** BLAZE is a decision-support and communication system, not an autonomous emergency commander. **The human incident commander always approves, modifies, or rejects critical actions before dispatch.**

---

## 1. Pipeline overview

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

Everything runs **locally**: Gemma 4 is served through vLLM on an NVIDIA GPU, speech-to-text and text-to-speech are local models, and all external data is either fetched from public APIs or served from local caches. There is **zero cloud LLM dependency**.

---

## 2. Deterministic services vs. autonomous agents

BLAZE strictly separates **deterministic local services** (predictable, testable, no LLM inside) from **autonomous Gemma 4 agents** (reasoning, tool selection, planning). We never misrepresent a deterministic service as an LLM agent.

### 2.1 Deterministic local services (5)

#### Service 1 — Audio Ingestion Service

| | |
|---|---|
| **Input** | Five prerecorded French radio `.wav` files + `manifest.json` |
| **Output** | `AudioReceived` events with scenario timestamps and metadata |
| **Responsibilities** | Load the five audio files; attach scenario timestamps and metadata; emit `AudioReceived` events; manage the clean/radio-degraded audio fallback selection. |

#### Service 2 — Speech-to-Text Service (faster-whisper)

| | |
|---|---|
| **Implementation** | `faster-whisper` with a local Whisper-compatible model (French language hint) |
| **Input** | Audio files from the ingestion service |
| **Output** | `TranscriptReady` events: text, language, timestamps, confidence when available |
| **Responsibilities** | Transcribe audio locally; preserve the original audio and raw transcript; **never invent operational facts**. Not a Gemma agent. |

#### Service 3 — Tool Execution Layer

| | |
|---|---|
| **Input** | `ToolRequest` objects proposed by Gemma agents |
| **Output** | Structured `ToolResult` objects with provenance and timestamps |
| **Responsibilities** | Validate Gemma function-call arguments; execute **allowlisted** tools only; return structured results; time out safely; fall back to cached data; record provenance and timestamps; **never let Gemma execute arbitrary code**. |

#### Service 4 — Human Approval Gate

| | |
|---|---|
| **Input** | `DraftTacticalPlan` + `SafetyReview` + evidence and uncertainties |
| **Output** | `ApprovalDecision` (`approve` / `modify` / `reject`) with operator name and optional note |
| **Responsibilities** | Show the plan, evidence, uncertainty and safety review to the human commander; require an explicit decision; **block dispatch until approval**; record the decision for audit. |

#### Service 5 — Local Text-to-Speech Service (Piper)

| | |
|---|---|
| **Implementation** | Piper local TTS with a downloaded French voice |
| **Input** | Approved per-unit dispatch messages (`DispatchInstruction[]`) |
| **Output** | One WAV file per unit + audio path + generation latency |
| **Responsibilities** | Convert approved dispatch messages to audio; work fully offline; expose a text fallback if TTS fails. Not a Gemma agent. |

### 2.2 Autonomous Gemma 4 agents (5)

All five agents share one local Gemma 4 deployment served by vLLM, but each has its own prompt, inputs, outputs and responsibilities.

#### Agent 1 — Radio Intelligence Agent

| | |
|---|---|
| **Input** | Raw transcript, audio metadata, known unit names, firefighter lexicon, recent transcript context |
| **Output** | `RadioEvent[]`, extraction confidence, uncertainties, proposed tool calls, original evidence span from the transcript |
| **Responsibilities** | Identify the speaking unit; extract locations, hazards, resources and constraints; detect negation, **correction** and uncertainty; distinguish reported / inferred / confirmed facts; map messages to structured operational events; propose relevant tool calls **without executing them**. |
| **Must not** | Create a tactical plan. |

#### Agent 2 — Situation Context Agent

| | |
|---|---|
| **Input** | Incident coordinates and bounding box, current unit/resource state, available tool catalog, latest cached and live tool results |
| **Output** | `SituationSnapshot`, tool-call trace, list of missing information, data provenance |
| **Responsibilities** | Decide which territorial and environmental tools are useful; request weather, wind, elevation, cadastral buildings, roads, nearby assets and fire hotspots; normalize results into a single snapshot; explicitly mark source, timestamp and staleness; distinguish real public data from seeded demo data; identify missing or uncertain context. |
| **Must not** | Issue orders to firefighters. |

#### Agent 3 — Tactical Fusion and Planning Agent

| | |
|---|---|
| **Input** | Ordered `RadioEvent[]`, `SituationSnapshot`, current unit/resource state, current road graph, existing plan version (if any) |
| **Output** | `DraftTacticalPlan` with version, evidence references, assumptions, unresolved uncertainties, proposed unit actions |
| **Responsibilities** | Correlate radio reports with territorial data; update the incident state; resolve corrections **without deleting the audit trail**; flag unresolved contradictions; identify units and infrastructures at risk; call deterministic routing/resource tools when needed; produce a concise proposed operational roadmap with unit-specific actions, evidence and confidence; indicate which actions require human approval. |
| **Must not** | Dispatch anything. |

#### Agent 4 — Safety Critic Agent

| | |
|---|---|
| **Input** | Draft tactical plan, situation snapshot, unit/resource state, safety rules, evidence and uncertainty list |
| **Output** | `SafetyReview` with status `pass` / `revise` / `block`, critical objections, required changes, required confirmations, human approval requirements |
| **Responsibilities** | **Actively attempt to prove the plan is unsafe**: verify each unit has a valid retreat option; verify vehicle/road compatibility; verify water and visibility constraints; identify stale information, single-weak-source actions, unconfirmed hazardous materials, and contradictions between radio reports and external data. Either approve the plan for human review or require revision. |
| **Must not** | Replace the human commander. |

#### Agent 5 — Dispatch Agent

Runs **only after explicit human approval**.

| | |
|---|---|
| **Input** | Approved tactical plan, operator modifications, unit list, unit-specific missions, radio communication constraints |
| **Output** | `DispatchInstruction[]` — one concise message per recipient unit, with acknowledgement flag, priority, and TTS-ready text |
| **Responsibilities** | Convert the approved plan into one concise message per unit; include only information relevant to that unit; use unambiguous language; preserve critical numbers, route names and restrictions; require acknowledgement for critical instructions. |
| **Must not** | Add any action absent from the approved plan. |

---

## 3. Orchestration and state machine

The backend orchestrator is **deterministic** and owns the incident state. It is not itself an LLM agent.

### 3.1 States (15)

```text
IDLE
INGESTING_AUDIO
TRANSCRIBING
EXTRACTING_RADIO_EVENTS
COLLECTING_CONTEXT
BUILDING_SITUATION
DRAFTING_PLAN
SAFETY_REVIEW
AWAITING_HUMAN_APPROVAL
REVISING_PLAN
APPROVED
GENERATING_DISPATCH
DISPATCHED
COMPLETED
FAILED_WITH_FALLBACK
```

### 3.2 Transition rules

- Context collection (`COLLECTING_CONTEXT`) may run **in parallel** with transcription (`TRANSCRIBING`).
- Planning starts only when the minimum required radio and context data exist.
- Safety review is **mandatory** before approval.
- Dispatch is **impossible** before approval.
- Rejection returns to planning or ends the scenario.
- Modification creates a **new plan version** (audit trail preserved).
- Every transition emits a frontend event.
- Every transition is auditable.

---

## 4. Event streaming

The backend streams events to the frontend (SSE). Every streamed event uses one envelope:

```json
{
  "event_id": "...",
  "incident_id": "...",
  "event_type": "...",
  "timestamp": "...",
  "sequence": 1,
  "payload": {}
}
```

### Event types

```text
incident.started
audio.received
transcription.started
transcript.ready
radio_agent.started
radio_event.extracted
context_agent.started
tool.call.requested
tool.call.completed
situation.snapshot.ready
planning.started
plan.draft.ready
safety_review.started
safety_review.ready
approval.requested
approval.received
plan.revision.requested
dispatch.started
dispatch.instruction.ready
tts.started
tts.ready
dispatch.sent
metric.updated
network.mode.changed
fallback.activated
error
incident.completed
```

A complete mock stream lives under `/contracts/mocks/demo_event_stream.jsonl` so frontend work can begin before the backend and agents are ready.

---

## 5. Technology stack

| Layer | Technology | Why |
|---|---|---|
| **LLM** | Gemma 4, running **locally** | Offline capability on the fireground; function calling; no cloud dependency |
| **Inference** | vLLM on an NVIDIA GPU | Accepted NVIDIA inference stack; concurrent agent calls; measured metrics (latency, tokens/s) |
| **Speech-to-text** | faster-whisper (local, French hint) | Local, fast, no API key, robust on degraded radio audio |
| **Text-to-speech** | Piper (local French voice) | Fully offline per-unit voice dispatch, no API key |
| **Backend** | FastAPI (Python) | Deterministic orchestrator, state machine, tool execution, SSE streaming |
| **Frontend** | Next.js (App Router) | Single desktop control-room view: tactical map, timeline, agent trace, approval UI, NVIDIA metrics panel |
| **External data** | Open-Meteo, NASA FIRMS, Cadastre Etalab, OSM/Overpass + local caches | Public territorial context with offline fallback (see `DATA_SOURCES.md`) |

---

## 6. Design principles

1. **Human commander always approves.** Nothing is dispatched without an explicit human `approve` decision. Dispatch controls are disabled until approval.
2. **Services are deterministic, agents are autonomous.** No LLM inside services; no arbitrary code execution from agents. Tool calls are allowlisted, validated and audited.
3. **Provenance everywhere.** Every datum is labeled `live_public`, `cached_public`, `seeded_demo`, `human_report`, or `model_inference`.
4. **Corrections never erase history.** New information updates the world model with a versioned audit trail.
5. **Everything has a fallback.** Cached external data, clean-audio fallback, reference-transcript fallback, text-only dispatch fallback — the demo never hard-crashes.
6. **No hidden cloud.** Cloud LLM call count must be zero, visibly displayed, and the full pipeline must survive a network blackout.
