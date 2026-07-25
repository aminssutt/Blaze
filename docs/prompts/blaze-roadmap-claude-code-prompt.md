# Claude Code prompt: BLAZE roadmap + GitHub board setup

Copy everything below into Claude Code.

---

You are setting up a complete, parallel-safe roadmap and a GitHub Project board for our hackathon project **BLAZE**, built for the **Paris Gemma 4 Hackathon**.

We are **3 people** working in parallel during a very short hackathon window. The roadmap must allow all 3 people to develop simultaneously with:

- zero blocking wherever possible;
- minimal merge conflicts;
- frozen shared contracts defined before parallel work;
- a clean, reproducible end-to-end demo;
- a public and well-documented GitHub repository;
- one primary submission track: **Autonomous Agents**;
- an additional submission to the **NVIDIA GPU Challenge** by deploying Gemma 4 locally through an accepted NVIDIA inference stack, with **vLLM as the default choice**.

The final result must not be a simple transcription application, a generic chatbot, or a static dashboard. It must demonstrate a genuine autonomous workflow where Gemma 4 interprets field communications, chooses tools, correlates information, proposes an operational plan, challenges that plan, waits for human approval, and then generates personalized dispatch instructions.

## CRITICAL control rule — read first

Do **not** create, push, edit, delete, label, assign, or otherwise mutate anything on GitHub until I have reviewed and explicitly approved the complete plan.

### Step 1 — review only

Produce a single review document containing:

1. the complete proposed content of `/docs/ROADMAP.md`;
2. the proposed repository structure;
3. the frozen contract list and their schemas;
4. the complete proposed list of GitHub issues;
5. for every issue:
   - title;
   - body;
   - 2 to 4 acceptance criteria;
   - owner or placeholder owner;
   - workstream label;
   - phase label;
   - priority;
   - dependencies;
   - files or directories the issue is allowed to modify;
6. the proposed GitHub Project v2 configuration;
7. the proposed demo timeline;
8. the proposed risk and fallback plan.

Then **STOP** and wait for my explicit approval.

### Step 2 — only after approval

Only after I reply exactly with approval, create the repository artifacts, issues, labels, assignments, and GitHub Project board through `gh` CLI.

Never run a write-capable `gh` command before approval. Read-only commands such as `gh auth status`, repository inspection, branch listing, issue listing, or contributor listing are allowed.

## Reference and source-of-truth rules

Before producing the plan:

1. inspect the current repository;
2. read every relevant file matching:
   - `README*`;
   - `BLAZE*`;
   - `ROADMAP*`;
   - `PLAN*`;
   - `ARCHITECTURE*`;
   - `AGENTS*`;
   - `DEMO*`;
   - `PITCH*`;
   - `CONTRACT*`;
   - scripts that call `gh`;
3. use existing project documents as the source of truth when they are more precise than this prompt;
4. report contradictions before planning;
5. do not silently invent credentials, model names, hardware capacity, GitHub usernames, API responses, or operational data.

If the three GitHub usernames are not explicitly available, use these placeholders in the review document:

- `AI_OWNER` — Person 1, Gemma 4, agents, speech-to-text, inference and evaluation;
- `PLATFORM_OWNER` — Person 2, backend, tools, data integration, orchestration and TTS service;
- `PRODUCT_OWNER` — Person 3, frontend, map, UX, demo, documentation and pitch.

Before any GitHub write operation after approval, identify or ask for the exact mapping between these placeholders and real GitHub usernames.

## Project identity

### Name

**BLAZE**

### One-line description

An offline operational-intelligence system that transforms fragmented firefighter radio communications and live territorial data into a structured, safety-reviewed action plan, approved by a human incident commander and redistributed as personalized voice instructions to field units.

### Core statement

> Firefighters already describe the battlefield every second. BLAZE turns their voices into a live, structured and actionable operational roadmap.

### Human principle

BLAZE is a **decision-support and communication system**, not an autonomous emergency commander.

The human incident commander must always approve, modify, or reject critical actions before dispatch.

### Primary track

**Autonomous Agents**

The core evaluation loop is:

```text
Five prerecorded radio messages
        ↓
Local speech-to-text
        ↓
Radio Intelligence Agent
        ↘
          Tactical Fusion and Planning Agent
        ↗
Situation Context Agent + external/local tools
        ↓
Safety Critic Agent
        ↓
Human commander approval
        ↓
Dispatch Agent
        ↓
Local text-to-speech
        ↓
Personalized simulated radio messages for each unit
```

### NVIDIA GPU Challenge

Gemma 4 must be deployed locally on NVIDIA hardware using **vLLM by default**.

The demo must visibly expose real measured inference information:

- detected NVIDIA GPU name;
- inference engine name;
- model identifier;
- request latency;
- end-to-end latency;
- generated tokens per second when available;
- number of Gemma agent calls;
- number of concurrent calls;
- cloud LLM calls equal to zero;
- online/offline status.

Do not claim TensorRT-LLM, Dynamo, NIM, quantization, speedups, or benchmark results unless they are actually implemented and measured.

## Exact demo concept

The demo is a scripted but genuinely executed crisis scenario.

### Demo input

We have **five prerecorded French firefighter radio audio files**.

When the operator starts the incident:

1. all five audio files are loaded;
2. the speech-to-text pipeline can transcribe them concurrently for speed;
3. each audio retains a scenario timestamp;
4. the application releases and processes the resulting radio events in scenario order so the audience sees the crisis evolve progressively;
5. the external-data/context pipeline starts in parallel;
6. all Gemma reasoning, tool selection, plan generation, safety review and dispatch generation must be real;
7. external API responses may be cached locally for reliability and offline demonstration.

### The five audio messages

Prepare and use five short `.wav` files. These exact messages may be adjusted slightly for natural speech, but their meaning and expected structured outputs must remain stable.

#### Audio 1 — Initial hazard and blocked heavy-vehicle route

Speaker: `Alpha 3`

Suggested script:

> « Alpha 3 au PC, fumée noire très dense près du hangar. La D17 est bloquée pour notre CCF et on entend plusieurs explosions. »

Expected facts:

- unit: Alpha 3;
- dense black smoke;
- location near the hangar;
- D17 blocked for CCF/heavy firefighting vehicle;
- explosions heard but not yet confirmed;
- high urgency;
- visual or reconnaissance confirmation required.

#### Audio 2 — Low water and visibility

Speaker: `Alpha 3`

Suggested script:

> « Alpha 3, mise à jour : il nous reste environ trente pour cent d’eau et la visibilité devient presque nulle. »

Expected facts:

- Alpha 3 water level becomes 30%;
- visibility becomes critical;
- unit risk level increases;
- current mission must be reassessed.

#### Audio 3 — Wind shift and faster spread

Speaker: `Bravo 2`

Suggested script:

> « Bravo 2 au PC, le vent vient de tourner vers le sud-est. Le feu progresse beaucoup plus vite vers la D17. »

Expected facts:

- wind direction reported toward south-east;
- field observation conflicts with or updates the previous weather context;
- D17 and nearby units must be reassessed;
- propagation risk increases.

#### Audio 4 — Correction and vehicle-specific accessibility

Speaker: `Charlie 1`

Suggested script:

> « Charlie 1 au PC, correction : la D17 n’est pas totalement bloquée. Les véhicules légers passent encore, mais pas les CCF. »

Expected facts:

- this is a correction;
- D17 is not globally closed;
- D17 is restricted by vehicle type;
- CCF vehicles remain blocked;
- light vehicles may pass;
- previous road state must be updated rather than duplicated.

#### Audio 5 — Hazard confirmation

Speaker: `Bravo 2`

Suggested script:

> « Bravo 2 au PC, explosions confirmées derrière le hangar. Présence possible de bouteilles de gaz. On reste à distance. »

Expected facts:

- explosions are now confirmed by a field unit;
- possible gas cylinders or hazardous material;
- exclusion perimeter required;
- unit Bravo 2 remains outside the hazard zone;
- the plan must be updated before final approval.

### Audio preparation requirements

For every message create:

- one clean `.wav` version;
- one radio-degraded `.wav` version;
- the exact reference transcript;
- expected unit identifier;
- expected structured events;
- expected tool calls;
- expected effect on the operational plan.

Recommended local file structure:

```text
/data/audio/
  01_alpha_initial_clean.wav
  01_alpha_initial_radio.wav
  02_alpha_resources_clean.wav
  02_alpha_resources_radio.wav
  03_bravo_wind_clean.wav
  03_bravo_wind_radio.wav
  04_charlie_correction_clean.wav
  04_charlie_correction_radio.wav
  05_bravo_confirmation_clean.wav
  05_bravo_confirmation_radio.wav
  manifest.json
```

The demo must default to the radio-degraded versions but offer a one-click fallback to clean audio.

## Services versus autonomous agents

Do not misrepresent deterministic services as LLM agents.

### Deterministic local services

#### 1. Audio Ingestion Service

Responsibilities:

- load the five audio files;
- attach scenario timestamps and metadata;
- emit `AudioReceived` events;
- manage clean/radio fallback selection.

#### 2. Speech-to-Text Service

Default implementation: `faster-whisper` using a local Whisper-compatible model.

Responsibilities:

- transcribe audio locally;
- return text, language, timestamps and confidence information when available;
- preserve the original audio and raw transcript;
- never invent operational facts;
- emit `TranscriptReady` events.

This is not a Gemma agent.

#### 3. Tool Execution Layer

Responsibilities:

- validate Gemma function-call arguments;
- execute allowlisted tools;
- return structured results;
- time out safely;
- fall back to cached data;
- record provenance and timestamps;
- never let Gemma execute arbitrary code.

#### 4. Human Approval Gate

Responsibilities:

- show the plan, evidence, uncertainty and safety review;
- require explicit `approve`, `modify`, or `reject`;
- block dispatch until approval;
- record the decision and optional operator note.

#### 5. Local Text-to-Speech Service

Default implementation: Piper local TTS with a downloaded French voice.

Responsibilities:

- convert approved per-unit dispatch messages to audio;
- generate one WAV per unit;
- return audio path and generation latency;
- work offline;
- expose a text fallback if TTS fails.

This is not a Gemma agent.

## Autonomous Gemma 4 agents

Use **five specialized Gemma agents**. They may share one local Gemma 4 vLLM deployment but must have separate prompts, inputs, outputs and responsibilities.

### Agent 1 — Radio Intelligence Agent

Input:

- raw transcript;
- audio metadata;
- known unit names;
- firefighter lexicon;
- recent transcript context.

Tasks:

- identify the speaking unit;
- extract location references;
- extract observed hazards;
- extract unit resources and constraints;
- detect negation, correction and uncertainty;
- distinguish reported, inferred and confirmed facts;
- map the message to structured operational events;
- propose relevant tool calls without executing them.

Output:

- `RadioEvent[]`;
- extraction confidence;
- uncertainties;
- proposed tool calls;
- original evidence span from the transcript.

It must not create a tactical plan.

### Agent 2 — Situation Context Agent

Input:

- incident coordinates and bounding box;
- current unit/resource state;
- available tool catalog;
- latest cached and live tool results.

Tasks:

- decide which territorial and environmental tools are useful;
- request weather, wind, elevation, relief, cadastral buildings, roads, nearby assets and fire hotspots;
- normalize results into a single `SituationSnapshot`;
- explicitly mark source, timestamp and staleness;
- distinguish real public data from seeded demo data;
- identify missing or uncertain context.

Output:

- `SituationSnapshot`;
- tool-call trace;
- list of missing information;
- data provenance.

It must not issue orders to firefighters.

### Agent 3 — Tactical Fusion and Planning Agent

Input:

- ordered `RadioEvent[]`;
- `SituationSnapshot`;
- current unit/resource state;
- current road graph;
- existing plan version, if any.

Tasks:

- correlate radio reports with territorial data;
- update the incident state;
- resolve corrections without deleting the audit trail;
- flag unresolved contradictions;
- identify units and infrastructures at risk;
- call deterministic routing/resource tools when needed;
- produce a concise proposed operational roadmap;
- generate unit-specific actions with evidence and confidence;
- indicate which actions require human approval.

Output:

- `DraftTacticalPlan`;
- plan version;
- evidence references;
- assumptions;
- unresolved uncertainties;
- proposed unit actions.

It must not dispatch anything.

### Agent 4 — Safety Critic Agent

Input:

- draft tactical plan;
- situation snapshot;
- unit/resource state;
- safety rules;
- evidence and uncertainty list.

Tasks:

- actively attempt to prove that the plan is unsafe;
- verify each unit has a valid retreat option;
- verify vehicle/road compatibility;
- verify water and visibility constraints;
- identify stale information;
- identify actions relying on one weak source;
- identify unconfirmed hazardous materials;
- identify contradictions between radio and external data;
- either approve the plan for human review or require revision;
- never replace the human commander.

Output:

- `SafetyReview`;
- status: `pass`, `revise`, or `block`;
- critical objections;
- required plan changes;
- required confirmations;
- human approval requirements.

### Agent 5 — Dispatch Agent

This agent can run only after explicit human approval.

Input:

- approved tactical plan;
- operator modifications;
- unit list;
- unit-specific missions;
- radio communication constraints.

Tasks:

- convert the approved plan into one concise message per unit;
- include only information relevant to that unit;
- use unambiguous language;
- preserve critical numbers, route names and restrictions;
- require acknowledgement for critical instructions;
- produce text suitable for local TTS;
- never add an action that is absent from the approved plan.

Output:

- `DispatchInstruction[]`;
- one message per recipient unit;
- required acknowledgement flag;
- priority;
- TTS-ready text.

## Tool and data integrations

The plan must distinguish between:

- live public API data;
- downloaded public geographic data;
- seeded demo operational data;
- cached API responses;
- simulated radio dispatch endpoints.

### Mandatory or strongly recommended integrations

#### Gemma 4 model access

Requirements:

- accepted Gemma 4 model weights available locally;
- Hugging Face or Kaggle account if required by the model distribution;
- `HF_TOKEN` only if the chosen download path requires it;
- model license accepted before the event;
- model fully downloaded before final demo rehearsal.

Official references:

- Gemma 4 function calling: `https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4`
- vLLM Gemma 4 guide: `https://docs.vllm.ai/projects/recipes/en/stable/Google/Gemma4.html`

#### NVIDIA inference

Requirements:

- NVIDIA GPU machine;
- correct NVIDIA driver;
- CUDA-compatible environment;
- vLLM installed and verified;
- Gemma 4 hello-world request completed;
- GPU memory checked before choosing the exact Gemma 4 checkpoint;
- inference metrics collection enabled.

No API key is required for local vLLM.

#### Speech-to-text

Default:

- `faster-whisper`;
- local model downloaded;
- French language hint;
- no API key;
- clean and noisy audio tested.

Reference:

- `https://github.com/SYSTRAN/faster-whisper`

#### Text-to-speech

Default:

- Piper local TTS;
- French voice model downloaded;
- no API key;
- one generated WAV per unit;
- text fallback always available.

Reference:

- `https://github.com/OHF-Voice/piper1-gpl`

#### Weather and wind

Default:

- Open-Meteo forecast/current weather API;
- no API key required for the planned non-commercial hackathon usage;
- cache the response used by the scenario.

Required fields:

- temperature;
- relative humidity;
- wind speed;
- wind direction;
- wind gusts;
- precipitation when available;
- retrieval timestamp.

Reference:

- `https://open-meteo.com/en/docs`

#### Elevation and terrain

Default:

- Open-Meteo Elevation API for quick integration;
- no API key required for the planned non-commercial hackathon usage;
- returns terrain elevation from a 90 m model;
- derive a simple local slope estimate from several nearby elevation points;
- cache all values used in the demo.

Reference:

- `https://open-meteo.com/en/docs/elevation-api`

#### Active-fire hotspots

Default:

- NASA FIRMS Area API;
- free `MAP_KEY` required;
- request the key before the hackathon;
- use one predefined bounding box and short time range;
- cache a valid response;
- never block the demo if FIRMS is unavailable.

Required environment variable:

```text
NASA_FIRMS_MAP_KEY=
```

Reference:

- `https://firms.modaps.eosdis.nasa.gov/api/map_key/`

#### Cadastral buildings and parcels

Default:

- Cadastre Etalab public download;
- no API key;
- download only one chosen commune or a small prepared area;
- use `batiments` and optionally `parcelles` GeoJSON;
- clip and simplify geometry before committing demo data;
- do not include owner/property-owner data because these are not part of the open plan data and are not needed.

References:

- `https://cadastre.data.gouv.fr/datasets`
- `https://cadastre.data.gouv.fr/datasets/cadastre-etalab`

#### Roads and nearby infrastructure

Default:

- OpenStreetMap data, optionally queried through Overpass;
- no API key for standard public Overpass usage;
- cache the selected roads, tracks, campings, water points, buildings and critical assets;
- do not depend on a live Overpass server during the pitch.

Possible features:

- roads and forest tracks;
- campings;
- water points;
- industrial buildings;
- hospitals or fire stations;
- electrical infrastructure;
- route restrictions.

#### Routing

For the demo, prefer a deterministic local graph over a complex external routing dependency.

Implement a small graph containing:

- D17;
- North Access;
- Forest Track 5;
- Water Point 2;
- Hangar Zone;
- Command Post;
- positions of Alpha 3, Bravo 2 and Charlie 1.

The routing tool must accept:

- vehicle type;
- blocked or restricted edges;
- danger polygons;
- origin;
- destination.

It must return:

- selected route;
- rejected routes;
- travel time estimate;
- reason;
- compatibility with vehicle type.

#### Firefighter units, staff and operational resources

There is no generic public real-time API that exposes the active staffing, live location, water remaining, mission and vehicle state of French firefighter units for this demo.

Therefore create clearly labeled seeded operational data.

Required local files:

```text
/data/scenario/units.json
/data/scenario/resources.json
/data/scenario/roads.json
/data/scenario/incidents.json
/data/scenario/safety_rules.json
```

Minimum seeded units:

- Alpha 3 — CCF, suppression mission, starts at 65% water;
- Bravo 2 — light reconnaissance vehicle, available for inspection;
- Charlie 1 — light unit able to confirm route accessibility;
- Command Post — human approval authority.

Minimum resource state:

- Water Point 2;
- one additional CCF available or unavailable;
- one reconnaissance capability;
- one industrial hangar;
- one camping or vulnerable area;
- one road restricted by vehicle type.

Every UI element and response must indicate whether a datum is:

- `live_public`;
- `cached_public`;
- `seeded_demo`;
- `human_report`;
- `model_inference`.

### Optional integrations — only after the core demo works

- EFFIS fire-danger layers;
- WorldPop or another population-exposure layer;
- real OSRM routing;
- local map tiles;
- LoRA/QLoRA adaptation;
- NVIDIA Dynamo on top of vLLM;
- TensorRT optimization;
- audio denoising model;
- speaker diarization.

None of these may block the core end-to-end demo.

## Required environment variables and prerequisites

Create a complete `.env.example` with no real secret values.

Suggested variables:

```text
# Model and inference
GEMMA_MODEL_ID=
HF_TOKEN=
VLLM_BASE_URL=http://localhost:8000
VLLM_API_KEY=local-only-placeholder

# NASA FIRMS
NASA_FIRMS_MAP_KEY=

# Scenario
SCENARIO_ID=wildfire-demo-01
DEMO_MODE=true
USE_CACHED_EXTERNAL_DATA=true
NETWORK_MODE=online

# Speech
WHISPER_MODEL_SIZE=small
WHISPER_LANGUAGE=fr
PIPER_VOICE_PATH=

# Backend/frontend
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8080
FRONTEND_PORT=3000
```

The local vLLM API key value, if required by the server command, is only a local placeholder and must never be described as an external AI-provider key.

### Pre-hackathon checklist

The roadmap must include issues for obtaining or preparing:

- [ ] exact Gemma 4 checkpoint access;
- [ ] accepted model license;
- [ ] model weights downloaded;
- [ ] NVIDIA GPU access;
- [ ] working NVIDIA driver and CUDA environment;
- [ ] vLLM Gemma 4 hello-world test;
- [ ] five clean audio files;
- [ ] five radio-degraded audio files;
- [ ] reference transcripts and expected outputs;
- [ ] faster-whisper model downloaded;
- [ ] Piper French voice downloaded;
- [ ] NASA FIRMS `MAP_KEY`;
- [ ] chosen French demo location and bounding box;
- [ ] cached Open-Meteo response;
- [ ] cached elevation response;
- [ ] cached FIRMS response;
- [ ] clipped cadastral GeoJSON;
- [ ] clipped OSM/Overpass GeoJSON;
- [ ] seeded firefighter units and resources;
- [ ] local route graph;
- [ ] safety rules;
- [ ] fallback JSON outputs;
- [ ] backup video recording plan.

## Exact system architecture

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

## Orchestration and state machine

The backend orchestrator is deterministic and owns the incident state. It is not itself a diagnostic LLM agent.

Required states:

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

Required transitions:

- context collection may run in parallel with transcription;
- planning starts only when the minimum required radio and context data exist;
- safety review is mandatory before approval;
- dispatch is impossible before approval;
- rejection returns to planning or ends the scenario;
- modification creates a new plan version;
- every transition emits a frontend event;
- every transition is auditable.

## Frozen shared contracts

Create `/contracts` in Phase 0 and freeze it before parallel development.

Use JSON Schema, Pydantic models, or generated TypeScript types, but the source of truth must be unambiguous.

Required contracts:

### `AudioManifestItem`

Fields:

- `audio_id`;
- `scenario_timestamp`;
- `speaker_hint`;
- `clean_path`;
- `radio_path`;
- `reference_transcript`;
- `expected_event_types`.

### `TranscriptResult`

Fields:

- `audio_id`;
- `text`;
- `language`;
- `segments`;
- `started_at`;
- `completed_at`;
- `latency_ms`;
- `model_name`;
- `fallback_used`.

### `RadioEvent`

Fields:

- `event_id`;
- `audio_id`;
- `unit_id`;
- `event_type`;
- `location_reference`;
- `facts`;
- `urgency`;
- `confidence`;
- `confirmation_status`;
- `is_correction`;
- `corrects_event_id`;
- `uncertainties`;
- `evidence_text`;
- `observed_at`;
- `source_type=human_report`.

### `ToolRequest`

Fields:

- `tool_call_id`;
- `agent_id`;
- `tool_name`;
- `arguments`;
- `reason`;
- `requested_at`.

### `ToolResult`

Fields:

- `tool_call_id`;
- `tool_name`;
- `status`;
- `data`;
- `source_type`;
- `source_name`;
- `retrieved_at`;
- `data_timestamp`;
- `is_cached`;
- `staleness_seconds`;
- `error`.

### `SituationSnapshot`

Fields:

- `incident_id`;
- `version`;
- `radio_events`;
- `weather`;
- `terrain`;
- `fire_hotspots`;
- `roads`;
- `buildings_and_parcels`;
- `critical_assets`;
- `units`;
- `resources`;
- `known_facts`;
- `uncertain_facts`;
- `conflicts`;
- `missing_information`;
- `provenance`;
- `generated_at`.

### `UnitAction`

Fields:

- `action_id`;
- `unit_id`;
- `action_type`;
- `instruction`;
- `route`;
- `destination`;
- `reason`;
- `priority`;
- `evidence_ids`;
- `confidence`;
- `human_approval_required`;
- `acknowledgement_required`.

### `DraftTacticalPlan`

Fields:

- `plan_id`;
- `incident_id`;
- `version`;
- `summary`;
- `objectives`;
- `unit_actions`;
- `rejected_options`;
- `assumptions`;
- `uncertainties`;
- `evidence_ids`;
- `created_at`.

### `SafetyReview`

Fields:

- `review_id`;
- `plan_id`;
- `status`;
- `critical_objections`;
- `required_changes`;
- `required_confirmations`;
- `rule_checks`;
- `reviewed_at`.

### `ApprovalDecision`

Fields:

- `decision_id`;
- `plan_id`;
- `decision`;
- `operator_name`;
- `operator_note`;
- `modified_actions`;
- `decided_at`.

### `DispatchInstruction`

Fields:

- `dispatch_id`;
- `plan_id`;
- `unit_id`;
- `priority`;
- `message_text`;
- `acknowledgement_required`;
- `tts_audio_path`;
- `generated_at`;
- `dispatch_status`.

### Frontend event envelope

Every streamed event uses one envelope:

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

Required event types:

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

Create a complete mock stream under `/contracts/mocks/demo_event_stream.jsonl` so frontend work begins before the backend and agents are ready.

## Repository boundaries and ownership

The repository must be structured so each person owns distinct directories.

```text
/
├── agents/
│   ├── radio_intelligence/       # AI_OWNER
│   ├── situation_context/        # AI_OWNER
│   ├── tactical_planning/        # AI_OWNER
│   ├── safety_critic/            # AI_OWNER
│   ├── dispatch/                 # AI_OWNER
│   └── common/                   # AI_OWNER, frozen interfaces after Phase 0
├── inference/                    # AI_OWNER
│   ├── vllm/
│   ├── prompts/
│   ├── evaluation/
│   └── metrics/
├── speech/
│   ├── stt/                      # AI_OWNER
│   └── tts/                      # PLATFORM_OWNER
├── backend/                      # PLATFORM_OWNER
│   ├── api/
│   ├── orchestrator/
│   ├── state/
│   ├── streaming/
│   └── loaders/
├── tools/                        # PLATFORM_OWNER
│   ├── weather/
│   ├── elevation/
│   ├── firms/
│   ├── cadastre/
│   ├── osm/
│   ├── routing/
│   └── resources/
├── data/                         # PLATFORM_OWNER
│   ├── audio/
│   ├── scenario/
│   ├── cached_external/
│   ├── geo/
│   └── evaluation/
├── frontend/                     # PRODUCT_OWNER
│   ├── app/
│   ├── components/
│   ├── map/
│   ├── events/
│   ├── audio/
│   └── lib/
├── design/                       # PRODUCT_OWNER
├── demo/                         # PRODUCT_OWNER
├── docs/                         # PRODUCT_OWNER, ROADMAP produced by Claude
├── contracts/                    # FROZEN after Phase 0; one designated merger
├── scripts/
│   ├── ai/                       # AI_OWNER
│   ├── platform/                 # PLATFORM_OWNER
│   └── product/                  # PRODUCT_OWNER
├── .env.example                  # PLATFORM_OWNER after team agreement
├── docker-compose.yml            # PLATFORM_OWNER
└── README.md                     # PRODUCT_OWNER, contributions through review
```

### No-conflict rules

- one owner per directory;
- no direct push to `main`;
- one feature branch per issue or tightly related issue set;
- all work merged through pull requests;
- `/contracts` is frozen after Phase 0;
- any contract change requires a dedicated PR reviewed by all three people;
- no broad formatting or dependency updates outside the issue scope;
- frontend must develop against the mock event stream first;
- agents must develop against frozen contracts and mocked tools first;
- backend must expose mock-compatible endpoints before real agent integration;
- only PLATFORM_OWNER edits root orchestration files, `.env.example`, and `docker-compose.yml`;
- only PRODUCT_OWNER edits shared design tokens and top-level demo script;
- only AI_OWNER edits agent system prompts;
- avoid a single shared Python requirements file if it creates conflicts; prefer scoped `pyproject.toml` or clearly owned dependency files;
- communicate before changing `/agents/common`, `/contracts`, or root configuration;
- perform short integration windows at planned checkpoints rather than continuous ad hoc merging.

### Branch naming

```text
ai/<issue-number>-<short-name>
platform/<issue-number>-<short-name>
product/<issue-number>-<short-name>
integration/<short-name>
```

### Merge order

1. scaffold and frozen contracts;
2. mock stream;
3. independent workstreams;
4. backend mock endpoints;
5. agents wired to mocked tools;
6. frontend wired to backend events;
7. real data adapters;
8. approval-to-dispatch path;
9. offline/fallback path;
10. demo stabilization only.

## Workstreams

### Workstream A — AI, Gemma 4 and NVIDIA inference (`AI_OWNER`)

Owns:

- Gemma 4 access and vLLM deployment;
- STT pipeline;
- five Gemma agents;
- prompts and tool schemas;
- structured-output validation;
- model evaluation;
- NVIDIA inference metrics;
- optional lightweight adaptation after the full pipeline works.

### Workstream B — Platform, backend and data (`PLATFORM_OWNER`)

Owns:

- FastAPI backend;
- deterministic orchestrator and state machine;
- event streaming;
- tool execution and validation;
- public-data adapters and caches;
- scenario state and unit/resource data;
- local route graph;
- human approval API;
- Piper TTS generation;
- offline mode;
- Docker/integration runtime.

### Workstream C — Product, frontend and demo (`PRODUCT_OWNER`)

Owns:

- control-room interface;
- tactical map;
- radio timeline;
- transcripts and extracted facts;
- agent/tool trace;
- source/provenance badges;
- draft-plan and Safety Critic views;
- approve/modify/reject UI;
- per-unit dispatch and TTS playback;
- NVIDIA metric panel;
- demo controller;
- design, pitch, README, Kaggle write-up support and backup video.

## Required product experience

Build one main desktop control-room view. Do not create multiple complex applications.

Required regions:

### 1. Header/status

Show:

- BLAZE;
- Gemma 4 model status;
- vLLM status;
- NVIDIA GPU status;
- online/offline status;
- incident state.

### 2. Tactical map

Show:

- D17;
- North Access;
- Forest Track 5;
- Hangar Zone;
- Water Point 2;
- vulnerable camping/area;
- Alpha 3, Bravo 2 and Charlie 1;
- fire/hazard zone;
- blocked/restricted routes;
- selected route;
- rejected route where useful.

### 3. Radio timeline

Show each audio with:

- speaker;
- time;
- audio player;
- transcript;
- clean/radio badge;
- processing status.

### 4. Structured-event panel

Show:

- extracted facts;
- correction badges;
- confirmation status;
- confidence;
- evidence text;
- human-report source.

### 5. Agent and tool trace

Show:

- which Gemma agent is running;
- which tool it requested;
- tool status;
- source type;
- cached/live status;
- latency;
- concise result.

Do not display private chain-of-thought. Display only auditable actions, tool calls, evidence and concise rationales.

### 6. Tactical roadmap

Show:

- current plan version;
- objectives;
- one action card per unit;
- reasons and evidence;
- rejected alternatives;
- assumptions and uncertainties.

### 7. Safety Critic

Show:

- pass/revise/block status;
- critical objections;
- required changes;
- required confirmations;
- safety-rule checks.

### 8. Human approval

Buttons:

- `Approve plan`;
- `Modify plan`;
- `Reject plan`.

Dispatch controls must remain disabled until approval.

### 9. Dispatch output

After approval show:

- one message for Alpha 3;
- one message for Bravo 2;
- one message for Charlie 1 when needed;
- generated TTS audio player;
- acknowledgement-required status;
- simulated dispatch state.

### 10. NVIDIA metrics

Show only measured values:

- GPU;
- model;
- engine;
- agent calls;
- concurrent requests;
- Gemma latency;
- end-to-end latency;
- tokens per second when available;
- local/cloud call count.

## Exact demonstration flow

Target duration: approximately 3 minutes.

### 0:00–0:20 — Human problem and initial state

Show:

- Alpha 3 assigned to reach Sector B12 through D17;
- Alpha 3 at 65% water;
- Bravo 2 available for reconnaissance;
- Charlie 1 on a light vehicle;
- D17 initially open;
- local Gemma 4 and vLLM running on NVIDIA.

Narration goal:

> Firefighters already communicate critical information over radio, but those messages are fragmented and difficult to correlate under stress.

### 0:20–0:45 — Start incident and parallel processing

Click `Start incident`.

The system must visibly launch:

- five audio transcriptions;
- context collection tools;
- cached/live status checks.

Show that these work in parallel.

### 0:45–1:10 — Audio 1 and 2 become operational events

Release Audio 1 and Audio 2 according to their scenario timestamps.

Show:

- raw transcript;
- Radio Intelligence extraction;
- D17 becomes blocked for CCF;
- explosions remain unconfirmed;
- Alpha 3 water falls to 30%;
- visibility becomes critical.

### 1:10–1:30 — Context correlation

Show tool results:

- wind and humidity;
- elevation/terrain;
- cadastral hangar/buildings;
- roads and water point;
- FIRMS hotspot, if available in the cached scenario;
- unit and resource state.

The Situation Context Agent produces one snapshot with provenance.

### 1:30–1:50 — Audio 3 and 4 update the world model

Show:

- field-reported wind shift;
- D17 risk increases;
- correction: D17 is accessible to light vehicles but not CCF;
- the previous event is corrected, not deleted;
- map styling changes by vehicle type.

### 1:50–2:10 — Draft plan and Safety Critic

The Tactical Planning Agent proposes an initial plan.

The Safety Critic must identify at least one material risk, such as:

- Alpha 3 has insufficient water and near-zero visibility;
- the alternative route adds unsafe travel time;
- D17 restriction is vehicle-specific;
- explosions/hazardous materials require an exclusion perimeter;
- a route may conflict with the reported wind shift.

The planning agent revises the plan or the critic returns a `revise` status.

### 2:10–2:25 — Audio 5 confirms hazard

Show:

- explosions confirmed;
- possible gas cylinders;
- exclusion zone added;
- reconnaissance unit remains at distance;
- final plan version generated.

### 2:25–2:40 — Human validation

The incident commander sees:

- unit-specific actions;
- evidence;
- uncertainties;
- Safety Critic review.

The presenter clicks `Approve plan`.

### 2:40–2:55 — Dispatch and TTS

The Dispatch Agent creates concise approved messages.

Example expected outputs:

#### Alpha 3

> « Alpha 3, mission d’attaque annulée. Repli par l’accès nord vers le point d’eau 2. D17 interdite aux CCF. Accusez réception. »

#### Bravo 2

> « Bravo 2, maintenez une reconnaissance à distance du hangar. Suspicion de bouteilles de gaz. N’entrez pas dans le périmètre d’exclusion. Accusez réception. »

#### Charlie 1

> « Charlie 1, confirmez l’accès D17 pour véhicules légers uniquement et restez hors du corridor de propagation. »

Piper generates and plays the messages locally.

### 2:55–3:10 — Offline and NVIDIA proof

Switch to `Network blackout`.

Show:

- cloud unavailable;
- Gemma 4 still operational locally;
- vLLM operational;
- cached territorial data available;
- STT and TTS local;
- measured NVIDIA inference panel.

Final narration:

> We are not adding another sensor to the fireground. We are unlocking the sensor that was already there: every firefighter.

## Safety and honesty requirements

Every task and UI must respect:

- this is a hackathon prototype, not a certified operational product;
- simulated firefighter resources must be labeled `seeded_demo`;
- simulated radio endpoints must be labeled `simulated_dispatch`;
- external data must include source and timestamp;
- cached data must be labeled cached;
- Gemma suggestions are not ground truth;
- critical actions require human approval;
- dispatch messages must never include unapproved actions;
- no claim of lives saved or response-time reduction without evidence;
- no claim that plans cadastral data include property owners;
- no hidden dependence on a cloud LLM;
- no arbitrary code execution from model output;
- tool calls are allowlisted, validated and audited;
- do not expose private model chain-of-thought in the UI or logs.

## Model adaptation and evaluation

The full end-to-end demo has priority over fine-tuning.

### Mandatory

Create a small evaluation dataset containing:

- five demo messages;
- at least 20 additional test messages;
- negations;
- corrections;
- vehicle-specific restrictions;
- ambiguous numbers;
- missing speaker;
- contradictory reports;
- unconfirmed versus confirmed events.

Measure:

- valid structured output rate;
- correct unit extraction;
- correct location/road extraction;
- correction detection;
- confirmation-status accuracy;
- correct tool selection;
- unsupported-fact/hallucination count.

### Optional only after integration

- 100–300 synthetic training examples;
- few-shot comparison;
- LoRA or QLoRA adaptation;
- base-versus-adapted evaluation.

Never fabricate benchmark improvement numbers.

## Phases

### Phase 0 — Unblock and freeze interfaces

Must finish first and quickly.

Required outputs:

- repository scaffold;
- ownership boundaries;
- branch strategy;
- exact team username mapping or placeholders;
- `.env.example`;
- Gemma 4 model-access check;
- NVIDIA/vLLM hello-world;
- STT hello-world;
- TTS hello-world;
- frozen contracts;
- mock event stream;
- scenario schemas;
- five audio manifest entries;
- initial GitHub board proposal.

Everything else may start only against the frozen contracts and mocks.

### Phase 1 — Parallel build

All three workstreams build independently:

- AI_OWNER builds inference, STT and agents against mocked tools;
- PLATFORM_OWNER builds backend, data adapters, state machine, TTS and events against mocked agent outputs;
- PRODUCT_OWNER builds the complete UI against the mock event stream.

### Phase 2 — Integration

Required order:

1. STT to Radio Intelligence;
2. tool adapters to Situation Context;
3. radio events + context to Tactical Planning;
4. draft plan to Safety Critic;
5. Safety Critic to human approval;
6. approved plan to Dispatch Agent;
7. dispatch text to TTS;
8. backend events to frontend;
9. offline/cached mode;
10. first complete end-to-end demo.

### Phase 3 — Stabilization and submission

Required outputs:

- deterministic demo reset;
- five-audio scenario tested repeatedly;
- clean-audio fallback;
- cached-data fallback;
- precomputed-transcript fallback;
- precomputed-agent-output fallback only for emergency backup;
- error banners rather than crashes;
- measured NVIDIA metrics;
- README;
- architecture diagram;
- public repository check;
- Kaggle write-up content;
- demo script;
- backup demo video;
- pitch rehearsal;
- final submission checklist.

### Buffer

Reserve a final buffer in which no new features are accepted.

Only:

- bug fixes;
- demo reliability;
- copy cleanup;
- performance measurements;
- video recording;
- rehearsal.

## Seed tasks per workstream

Expand every seed task into small GitHub issues with 2 to 4 acceptance criteria.

### Phase 0 — Shared/unblock

- Inspect current repo and report existing assets and contradictions.
- Confirm three GitHub username mappings.
- Create repository scaffold and CODEOWNERS proposal.
- Define branch and PR policy.
- Freeze all shared contracts.
- Create generated TypeScript/Python contract strategy.
- Create complete mock frontend event stream.
- Create `.env.example` without secrets.
- Verify public-repository requirement.
- Propose GitHub Project v2 fields, labels and views.
- Create five-audio manifest and expected outputs.
- Define scenario coordinate/bounding box.
- Obtain NASA FIRMS key checklist item.
- Verify Gemma 4 model access and license.
- Verify NVIDIA GPU, CUDA and vLLM.
- Verify faster-whisper.
- Verify Piper French voice.

### AI_OWNER seed tasks

- Implement Gemma 4 vLLM launch and health check.
- Implement NVIDIA metric collector.
- Implement local faster-whisper transcription service.
- Add batch/concurrent transcription for five audios.
- Implement Radio Intelligence Agent prompt and schema.
- Implement correction/negation/confirmation tests.
- Implement Situation Context Agent prompt and tool-selection schema.
- Implement Tactical Planning Agent prompt and output validation.
- Implement Safety Critic Agent and explicit safety checks.
- Implement Dispatch Agent with approved-plan-only constraints.
- Implement shared Gemma inference client.
- Implement timeout/retry and structured-output repair.
- Create evaluation dataset and runner.
- Run and record actual metrics.
- Optional only after green end-to-end: few-shot or LoRA comparison.

### PLATFORM_OWNER seed tasks

- Implement FastAPI scaffold and health endpoints.
- Implement deterministic incident state machine.
- Implement event streaming through SSE or WebSocket.
- Implement scenario reset/start endpoints.
- Implement Audio Ingestion Service.
- Implement tool-call validation and allowlist.
- Implement Open-Meteo weather adapter.
- Implement Open-Meteo elevation adapter and simple slope calculation.
- Implement NASA FIRMS adapter and cache fallback.
- Implement cadastral GeoJSON loader.
- Implement OSM/Overpass GeoJSON loader.
- Implement seeded unit/resource loader.
- Implement local vehicle-aware routing graph.
- Implement source/provenance tagging.
- Implement context snapshot builder runtime.
- Implement human approval API.
- Implement plan versioning and modification.
- Implement Piper local TTS service.
- Implement simulated radio dispatch endpoint.
- Implement offline network-mode switch.
- Implement complete cached-data fallback.
- Implement Docker Compose and startup script.
- Integrate all agents into orchestrator after contracts freeze.

### PRODUCT_OWNER seed tasks

- Implement frontend scaffold.
- Implement mock event-stream player.
- Implement incident start/reset controls.
- Implement online/offline toggle.
- Implement tactical map with scenario geometry.
- Implement unit markers and resource states.
- Implement route status by vehicle type.
- Implement radio timeline and audio players.
- Implement live transcript cards.
- Implement structured RadioEvent cards.
- Implement provenance/source badges.
- Implement agent/tool trace.
- Implement SituationSnapshot summary.
- Implement tactical-plan version view.
- Implement unit-action cards.
- Implement Safety Critic panel.
- Implement approve/modify/reject workflow.
- Implement dispatch message list.
- Implement TTS audio playback per unit.
- Implement NVIDIA metric panel.
- Implement fallback/error states.
- Wire frontend to real backend stream.
- Create architecture diagram.
- Write README and setup instructions.
- Draft demo script and pitch.
- Record backup demo video.

### Shared integration/demo tasks

- First end-to-end run with one audio.
- End-to-end run with all five audios.
- Validate corrections update state without erasing history.
- Validate context collection runs in parallel with transcription.
- Validate Safety Critic blocks unsafe first plan.
- Validate human approval blocks dispatch.
- Validate modified plan creates a new version.
- Validate Dispatch Agent does not invent new actions.
- Validate Piper generates one WAV per unit.
- Validate offline mode works with caches.
- Validate clean-audio fallback.
- Validate precomputed-transcript fallback.
- Measure vLLM and end-to-end latency.
- Record a complete backup video.
- Rehearse pitch and handoff between speakers.
- Verify public repository, code documentation and Kaggle write-up.

## GitHub Project v2 configuration

Propose a project with these fields:

### Status

- Backlog
- Ready
- In Progress
- In Review
- Blocked
- Done

### Priority

- P0 — demo blocking
- P1 — core
- P2 — important
- P3 — optional

### Phase

- Phase 0 — Unblock
- Phase 1 — Parallel Build
- Phase 2 — Integration
- Phase 3 — Demo and Submission
- Buffer

### Workstream

- AI / Agents
- Platform / Backend
- Product / Frontend
- Shared / Demo

### Suggested labels

```text
workstream:ai
workstream:platform
workstream:product
workstream:shared
phase:0-unblock
phase:1-build
phase:2-integration
phase:3-demo
phase:buffer
priority:p0
priority:p1
priority:p2
priority:p3
contract-change
demo-blocker
offline
nvidia
agentic
speech
external-data
fallback
```

### Required views

- Board by Status;
- Table by Phase;
- Board by Assignee;
- P0/P1 Demo Blockers;
- Integration Queue;
- NVIDIA Challenge tasks;
- Unassigned/Blocked issues.

## Issue quality rules

Every issue must:

- be finishable in one short focused sitting where possible;
- have one accountable owner;
- name exact allowed directories;
- include 2 to 4 testable acceptance criteria;
- list dependencies explicitly;
- state whether it blocks the demo;
- state whether it needs real data, cached data or mock data;
- avoid assigning the same file to two people;
- avoid vague tasks such as “build AI”, “make frontend”, or “connect everything”.

## Definition of done for the core demo

The demo is considered ready only if all items below pass:

- [ ] five audio files load;
- [ ] all five are transcribed locally;
- [ ] scenario timestamps preserve narrative order;
- [ ] radio events are structured by Gemma 4;
- [ ] corrections and confirmation status work;
- [ ] context tools return normalized source-tagged data;
- [ ] cadastral buildings and local roads render;
- [ ] seeded unit/resource state renders;
- [ ] Tactical Planning Agent creates a versioned plan;
- [ ] Safety Critic identifies a genuine risk;
- [ ] human approval is mandatory;
- [ ] Dispatch Agent creates only approved instructions;
- [ ] Piper produces playable per-unit audio;
- [ ] frontend receives streamed events;
- [ ] offline mode uses cached/local data;
- [ ] real vLLM/NVIDIA metrics are displayed;
- [ ] no cloud LLM call is made;
- [ ] demo can reset and rerun;
- [ ] clean-audio fallback works;
- [ ] backup video exists;
- [ ] repository is public and documented.

## Explicit non-goals

Do not spend hackathon time on:

- training a foundation model from scratch;
- building real radio-hardware integration;
- connecting to actual emergency-service dispatch systems;
- claiming access to real live firefighter staffing;
- full scientific wildfire-spread simulation;
- controlling real drones;
- building a mobile application;
- building multiple disaster scenarios;
- integrating every possible public API;
- creating ten or more agents;
- pixel-perfect design before end-to-end integration;
- production security certification;
- real automatic evacuation or deployment orders.

## Fallback hierarchy

Every external and model dependency must have a fallback.

### Level 0 — fully live/local intended demo

- radio-degraded audio;
- local STT;
- live local Gemma 4 through vLLM;
- live/cached tools;
- real planning, review and dispatch;
- local TTS.

### Level 1 — external API outage

- use cached weather, elevation, FIRMS, cadastre and OSM data;
- continue real Gemma reasoning.

### Level 2 — STT instability

- switch to clean audio;
- then use reference transcript while clearly labeling fallback.

### Level 3 — TTS instability

- display and dispatch text;
- play a pre-generated local TTS WAV.

### Level 4 — inference instability

- restart vLLM;
- switch to a smaller supported Gemma 4 checkpoint if available;
- as an emergency presentation-only fallback, replay precomputed agent events while disclosing fallback mode;
- use the prerecorded complete demo video if the live system cannot recover.

## Required deliverables

After approval, the implementation plan must produce:

1. `/docs/ROADMAP.md`;
2. `/docs/ARCHITECTURE.md`;
3. `/docs/DEMO_SCRIPT.md`;
4. `/docs/PITCH.md`;
5. `/docs/DATA_SOURCES.md`;
6. `/docs/SAFETY_AND_LIMITATIONS.md`;
7. `/contracts` with schemas and mock event stream;
8. `.env.example`;
9. a public GitHub Project v2 board;
10. all scoped GitHub issues assigned to the three real usernames;
11. a working local setup script or Docker Compose flow;
12. a clean README with prerequisites and startup order;
13. a backup demo video;
14. a short NVIDIA deployment and benchmark section;
15. Kaggle write-up-ready architecture and engineering notes.

## `gh` CLI rules

Before any write operation after approval:

1. run `gh auth status`;
2. report the active account;
3. verify the target repository;
4. verify whether the repository is public;
5. verify the three assignee usernames;
6. verify permissions to create issues and Projects;
7. report any mismatch and stop before mutating state.

After approval, use appropriate commands such as:

- `gh label create`;
- `gh issue create --assignee --label --body`;
- `gh project create`;
- `gh project field-create`;
- `gh project item-add`;
- repository file creation through normal git branches and pull requests.

Do not push directly to `main`.

## Final instruction

Produce the complete review document first.

Make the plan detailed enough that three developers can begin immediately in separate directories and integrate through frozen contracts without touching the same files.

Then STOP and wait for explicit approval before creating anything.
