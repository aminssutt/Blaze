# BLAZE — Safety and Limitations

BLAZE is a **decision-support and communication system**, not an autonomous emergency commander. This page states plainly what BLAZE is, what it is not, and the safety rules every component and UI element must respect.

## What BLAZE is not

- **Not a certified operational product.** BLAZE is a hackathon prototype. It has not been evaluated, certified, or approved for real emergency operations, and must not be used to direct real firefighters.
- **Not an autonomous commander.** The human incident commander must always approve, modify, or reject critical actions before anything is dispatched. Dispatch is technically impossible before an explicit human `approve` decision.
- **Not connected to real emergency systems.** Radio endpoints are simulated and labeled `simulated_dispatch`. No real radio hardware, no real dispatch systems, no real staffing data.

## Honesty rules

Every task, view and claim in this project respects the following:

1. **Simulated data is labeled.** Simulated firefighter resources are labeled `seeded_demo`. Simulated radio endpoints are labeled `simulated_dispatch`. No public real-time API exposes live French firefighter staffing, so this data is simulated by design — and never presented as real.
2. **External data carries source and timestamp.** Every external datum includes its source name and retrieval timestamp. Cached data is explicitly labeled cached, with staleness information.
3. **Gemma suggestions are not ground truth.** Model outputs are labeled `model_inference` and presented as suggestions with confidence and evidence, never as facts.
4. **Critical actions require human approval.** The Human Approval Gate blocks dispatch until an explicit `approve` / `modify` / `reject` decision is recorded.
5. **Dispatch messages never include unapproved actions.** The Dispatch Agent may only rephrase the approved plan per unit; it cannot add actions.
6. **No unmeasured claims.** No claim of lives saved, response-time reduction, or benchmark improvement without actual measured evidence. Unavailable metrics are shown as TODO, never invented.
7. **No claim about cadastral property owners.** The cadastral data used contains buildings and parcels geometry only; owner data is not part of the open plan data and is not used.
8. **No hidden cloud LLM dependency.** All inference is local (Gemma 4 via vLLM on NVIDIA). The UI displays a cloud-LLM call count, which must be zero, and the demo includes a network-blackout proof.

## Model-output safety

- **No arbitrary code execution from model output.** Gemma agents can only *propose* tool calls; the deterministic Tool Execution Layer validates arguments, executes **allowlisted** tools only, times out safely, and records every call.
- **Tool calls are allowlisted, validated and audited.** Every `ToolRequest`/`ToolResult` is logged with provenance and timestamps.
- **No private chain-of-thought is exposed.** The UI and logs display only auditable actions: tool calls, evidence, structured outputs, and concise rationales — never raw model reasoning traces.
- **Corrections preserve the audit trail.** New or corrected information updates the incident state without deleting history; plan modifications create new versions.
- **The Safety Critic is adversarial by design.** A dedicated agent actively attempts to prove each draft plan unsafe (retreat options, vehicle/road compatibility, water/visibility constraints, stale or single-source information, unconfirmed hazardous materials) before the plan ever reaches the human commander. It complements — and never replaces — human judgment.

## Known limitations

- Single scripted scenario (one wildfire incident, five prerecorded French audio messages) — not a general-purpose incident system.
- Speech-to-text quality depends on radio audio degradation; a clean-audio fallback and a labeled reference-transcript fallback exist.
- External data sources may be served from caches for reliability; staleness is displayed.
- The routing graph is a small seeded demo graph, not a full road network.
- Evaluation is limited to a small test set (see `KAGGLE_WRITEUP.md`, Results section); measured numbers only.
