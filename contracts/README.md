# BLAZE — Frozen shared contracts

These contracts are **FROZEN after Phase 0**. They are the interface between the three parallel
workstreams (AI/agents, platform/backend, product/frontend).

## Rules

- **Source of truth**: the JSON Schema files in [`schemas/`](./schemas) (draft-07). Any Pydantic
  model or TypeScript type must be derived from — and stay consistent with — these schemas.
- **Any change requires a dedicated PR** reviewed and approved by **all three** of us:
  `aminssutt`, `selyan-mhli`, `six-16`. No contract change may ride along inside a feature PR.
- No direct push to `main`; contract PRs carry the `contract-change` label.

## Contents

- `schemas/` — one JSON Schema per contract (`AudioManifestItem`, `TranscriptResult`,
  `RadioEvent`, `ToolRequest`, `ToolResult`, `SituationSnapshot`, `UnitAction`,
  `DraftTacticalPlan`, `SafetyReview`, `ApprovalDecision`, `DispatchInstruction`,
  `EventEnvelope`).
- `mocks/demo_event_stream.jsonl` — a complete mock event stream of the demo scenario
  (`wildfire-demo-01`), one envelope-wrapped JSON event per line, in scenario order.

## Mock stream

The mock stream lets the **frontend develop the full control-room UI without any backend or
agent being ready**: replay the JSONL line by line (respecting `sequence` / `timestamp`) and
render every panel against it. Backend and agents must emit events that stay compatible with
this stream and with `schemas/event_envelope.schema.json`.

All metric values in the mock stream are **placeholders marked "mock"** — never present them
as measured numbers.
