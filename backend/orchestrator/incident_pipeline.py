"""BLAZE incident pipeline — first REAL end-to-end run for ONE audio (issue #52).

Wires the real, merged components into the full flow for a single audio file:

    audio (radio variant) -> faster-whisper STT -> Radio Intelligence (Gemma)
    -> Situation Context (Gemma + real tool layer) -> Tactical Planning (Gemma)
    -> Safety Critic (rules + Gemma) -> PROGRAMMATIC approval (E2E harness)
    -> Dispatch (Gemma) -> Piper TTS -> one WAV per unit.

Every step drives the deterministic :class:`IncidentStateMachine` so the run
emits the exact contract-valid event stream the frontend consumes, and every
model call is accounted in ONE shared :class:`CallLog` feeding the
:class:`MetricsCollector` (measured latencies/tokens only, never invented).

HUMAN APPROVAL NOTE — in the real demo the approval is the human incident
commander's button (Approve / Modify / Reject in the control room UI). This
pipeline is an automated E2E harness, so it records an explicit, clearly
labeled programmatic decision::

    {"decision": "approve", "operator_name": "e2e-harness",
     "operator_note": "automated E2E test approval"}

Nothing is dispatched before that decision is recorded (state machine +
DispatchAgent both enforce it).

Failure policy: if the safety review still refuses the plan after the bounded
revision loop, the pipeline calls ``fail_with_fallback`` and raises — it never
fakes a pass.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Mapping

from jsonschema import Draft7Validator, FormatChecker

from agents.common.inference_client import CallLog, GemmaClient
from agents.dispatch.agent import DispatchAgent
from agents.radio_intelligence.agent import RadioIntelligenceAgent
from agents.safety_critic.agent import SafetyCriticAgent
from agents.situation_context.agent import SituationContextAgent, catalog_from_registry
from agents.tactical_planning.agent import TacticalPlanningAgent
from backend.orchestrator.tool_executor import ToolAuditLog, ToolExecutor
from backend.orchestrator.tool_registry import build_full_registry
from backend.state.machine import (
    ApprovalDecision,
    IncidentStateMachine,
    SafetyReviewStatus,
)
from inference.metrics.collector import MetricsCollector
from speech.stt.service import SttService, load_manifest
from speech.tts.service import TTSService

logger = logging.getLogger("blaze.pipeline")

REPO_ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = REPO_ROOT / "data" / "scenario"
EVENT_ENVELOPE_SCHEMA_PATH = REPO_ROOT / "contracts" / "schemas" / "event_envelope.schema.json"

#: Demo location frozen in #92: Frontignan / Massif de la Gardiole (Herault).
DEMO_BBOX_WSEN = [3.73, 43.44, 3.77, 43.47]
DEMO_LOCATION_NAME = "Frontignan / Massif de la Gardiole (Herault, France)"

#: Tools requested deterministically if the model selects none (the planning
#: gate requires at least one context tool result).
FALLBACK_CONTEXT_TOOLS = ("get_weather", "get_resources")

DEFAULT_MAX_REVISIONS = 2
DEFAULT_LLM_TIMEOUT_S = 120.0

#: Deterministic remediation hints attached to the revision feedback when a
#: mechanical safety rule fails — live runs showed the planner cannot infer
#: HOW to satisfy the rule engine from the failure text alone (issue #52).
RULE_REMEDIATION_HINTS: Dict[str, str] = {
    "sr-retreat-route": (
        "For each engaged unit named in the failure: add a separate 'retreat' "
        "action with an explicit open route, OR add a 'retreat_route': '<road_id>' "
        "field inside its action, OR — if the unit is actually waiting at a safe "
        "location — change its action_type to 'standby' ('hold_position'/'defend' "
        "mechanically count as engaged)."
    ),
    "sr-vehicle-road-compat": (
        "Route every moving unit only on roads whose allowed_vehicle_types include "
        "its vehicle type, using road ids exactly as written in ROAD_GRAPH "
        "(e.g. 'd17', 'north-access'); never a name, never the string 'null'."
    ),
    "sr-min-water": (
        "Do not task offensive suppression for a unit below the water thresholds; "
        "add a refill action at a water point instead."
    ),
    "sr-visibility": (
        "Remove offensive taskings while visibility is near-zero; prefer withdrawal."
    ),
    "sr-hazmat-perimeter": (
        "Add an exclusion-perimeter action (action_type 'establish_perimeter', "
        "300 m default radius) around the suspected hazardous material."
    ),
    "sr-human-approval": "Set human_approval_required=true on EVERY action.",
}


class PipelineFailure(RuntimeError):
    """The pipeline could not complete honestly (state machine already failed over)."""


class TemperedClient:
    """Delegating GemmaClient wrapper that injects a default temperature.

    Live finding (#52): agents that do not pass ``temperature`` inherit the
    server default (~1.0), which made the planner produce a structurally
    different plan on every run (hold_position without retreat, string "null"
    routes, ...). The orchestrator — configuration owner — pins a low default;
    an agent explicitly passing ``temperature`` (e.g. the safety critic's 0.2)
    keeps its own value. No agent code is modified.
    """

    def __init__(
        self, client: GemmaClient, temperature: float, max_tokens: int | None = None
    ) -> None:
        self._client = client
        self._temperature = float(temperature)
        self._max_tokens = max_tokens

    async def chat(self, messages, **kwargs):  # noqa: ANN001 — passthrough
        kwargs.setdefault("temperature", self._temperature)
        return await self._client.chat(messages, **kwargs)

    async def chat_structured(self, messages, **kwargs):  # noqa: ANN001 — passthrough
        if kwargs.get("temperature") is None:
            kwargs["temperature"] = self._temperature
        # Live finding (#52): guided decoding occasionally degenerates into a
        # whitespace loop that runs until the context window is full, turning
        # one bad call into an unrecoverable 400 on the repair attempt. A hard
        # output bound keeps the failure cheap and repairable.
        if kwargs.get("max_tokens") is None and self._max_tokens:
            kwargs["max_tokens"] = self._max_tokens
        return await self._client.chat_structured(messages, **kwargs)

    def __getattr__(self, name: str):
        return getattr(self._client, name)


def _sanitize_schema(node: Any) -> Any:
    """Copy of a JSON schema without $schema/$id/description/format annotations.

    Live finding (#52): the full snapshot contract schema (annotations included)
    is sent to vLLM as the guided-decoding grammar AND embedded in every repair
    prompt; the annotations add nothing to generation but bloat both.
    Validation still uses the ORIGINAL contract schema.
    """
    if isinstance(node, dict):
        return {
            key: _sanitize_schema(value)
            for key, value in node.items()
            if key not in {"$schema", "$id", "description", "format"}
        }
    if isinstance(node, list):
        return [_sanitize_schema(item) for item in node]
    return node


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


class IncidentPipeline:
    """Real end-to-end pipeline for ONE audio of the seeded wildfire scenario.

    Parameters
    ----------
    audio_index:
        Index into ``data/audio/manifest.json`` (0 = audio_01).
    variant:
        ``"radio"`` (degraded, demo default) or ``"clean"``.
    output_dir:
        Where TTS WAVs and the tool-audit JSONL are written.
    max_revisions:
        Bounded safety-revision loop (env ``E2E_MAX_REVISIONS`` overrides).
    """

    def __init__(
        self,
        *,
        audio_index: int = 0,
        variant: str = "radio",
        output_dir: Path | str | None = None,
        max_revisions: int | None = None,
        incident_id: str | None = None,
    ) -> None:
        if variant not in ("radio", "clean"):
            raise ValueError(f"variant must be 'radio' or 'clean', got {variant!r}")
        self.audio_index = int(audio_index)
        self.variant = variant
        self.output_dir = Path(
            output_dir
            if output_dir is not None
            else REPO_ROOT / "artifacts" / "e2e"
        )
        self.max_revisions = (
            int(max_revisions)
            if max_revisions is not None
            else int(os.getenv("E2E_MAX_REVISIONS", str(DEFAULT_MAX_REVISIONS)))
        )
        self.incident_id = incident_id or f"incident-e2e-{uuid.uuid4().hex[:8]}"
        self.timings_s: Dict[str, float] = {}

        # -- scenario data (seeded, deterministic) -------------------------
        self.manifest = load_manifest()
        self.units_doc = _read_json(SCENARIO_DIR / "units.json")
        self.roads_doc = _read_json(SCENARIO_DIR / "roads.json")
        self.unit_list: List[Dict[str, Any]] = [dict(u) for u in self.units_doc["units"]]
        self.known_units = [u["unit_id"] for u in self.unit_list]

        # -- shared accounting ---------------------------------------------
        self.call_log = CallLog()
        self.metrics = MetricsCollector()

        # -- deterministic services ----------------------------------------
        self.client = GemmaClient(
            call_log=self.call_log,
            timeout_s=float(os.getenv("E2E_LLM_TIMEOUT_S", str(DEFAULT_LLM_TIMEOUT_S))),
        )
        self.registry = build_full_registry()
        self.audit_log = ToolAuditLog()
        self.tool_executor = ToolExecutor(registry=self.registry, audit_log=self.audit_log)
        self.stt = SttService()
        self.tts = TTSService(output_dir=self.output_dir / "tts")

        # -- the 5 Gemma agents (shared client, pinned low temperature) ----
        tempered = TemperedClient(
            self.client,
            float(os.getenv("E2E_AGENT_TEMPERATURE", "0.2")),
            max_tokens=int(os.getenv("E2E_MAX_OUTPUT_TOKENS", "1300")),
        )
        self.radio_agent = RadioIntelligenceAgent(tempered, self.known_units)
        self.context_agent = SituationContextAgent(
            tempered,
            self.tool_executor,
            catalog=catalog_from_registry(self.registry.describe()),
        )
        # Orchestrator-side schema slimming for the LLM request only — the
        # agent's validator keeps enforcing the ORIGINAL contract schema.
        self.context_agent._snapshot_schema = _sanitize_schema(
            self.context_agent._snapshot_schema
        )
        self.planning_agent = TacticalPlanningAgent(
            tempered, tool_executor=self._planner_tool_call
        )
        self.safety_agent = SafetyCriticAgent(tempered)
        self.dispatch_agent = DispatchAgent(tempered)

        # -- state machine + event capture ---------------------------------
        self.machine = IncidentStateMachine(
            incident_id=self.incident_id, min_radio_events=1, min_context_results=1
        )
        self._envelope_validator = Draft7Validator(
            _read_json(EVENT_ENVELOPE_SCHEMA_PATH), format_checker=FormatChecker()
        )

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @contextmanager
    def _stage(self, name: str) -> Iterator[None]:
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.timings_s[name] = round(time.perf_counter() - t0, 3)
            logger.info("stage %-28s %8.3f s", name, self.timings_s[name])

    def _planner_tool_call(self, tool_name: str, arguments: Mapping[str, Any]) -> Dict[str, Any]:
        """Tactical-planning tool round -> real ToolExecutor (audited, allowlisted)."""
        args = dict(arguments)
        blocked = args.get("blocked_edges")
        if isinstance(blocked, list):
            # The planner tool contract offers plain road-id strings; the
            # registry schema wants EdgeRule objects. Deterministic adaptation.
            args["blocked_edges"] = [
                {"road_id": b} if isinstance(b, str) else b for b in blocked
            ]
        request = self.tool_executor.build_request(
            "tactical_planning", tool_name, args, reason="planning tool round"
        )
        try:
            return self.tool_executor.execute(request)
        except Exception as exc:  # noqa: BLE001 — surface as structured error to the LLM
            logger.warning("planner tool call %r failed: %s", tool_name, exc)
            return {"status": "error", "tool_name": tool_name, "error": str(exc)}

    def _incident_ctx(self) -> Dict[str, Any]:
        roads = [
            {
                "road_id": r["road_id"],
                "name": r.get("name"),
                "status": r.get("status", r.get("initial_status", "open")),
                "allowed_vehicle_types": r.get("allowed_vehicle_types"),
                "restrictions": r.get("restrictions", []),
            }
            for r in self.roads_doc.get("roads", [])
        ]
        return {
            "incident_id": self.incident_id,
            "scenario_id": self.units_doc.get("scenario_id"),
            "location": {"name": DEMO_LOCATION_NAME, "bbox_wsen": DEMO_BBOX_WSEN},
            "engaged_units": [
                {
                    "unit_id": u["unit_id"],
                    "callsign": u.get("callsign"),
                    "vehicle_type": u.get("vehicle_type"),
                    "mission": u.get("mission"),
                    "status": u.get("status"),
                    "water_pct": u.get("water_pct"),
                }
                for u in self.unit_list
            ],
            "seeded_road_state": roads,
            "data_mode": {
                "use_cached_external_data": os.getenv("USE_CACHED_EXTERNAL_DATA", "true"),
                "network_mode": os.getenv("NETWORK_MODE", "online"),
            },
        }

    def _merge_seeded_roads(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """Deterministically merge the seeded scenario road state into the snapshot.

        The mechanical safety rules (vehicle/road compatibility, retreat routes)
        index ``snapshot["roads"]`` by ``road_id``. The seeded road state is the
        orchestrator's own deterministic data (provenance ``seeded_demo``), so
        the orchestrator — not the model — injects any road missing from the
        model-built snapshot. Model-provided road entries are never overwritten.
        """
        existing = {
            r.get("road_id")
            for r in snapshot.get("roads") or []
            if isinstance(r, Mapping) and r.get("road_id")
        }
        added: List[str] = []
        snapshot.setdefault("roads", [])
        for road in self.roads_doc.get("roads", []):
            if road["road_id"] in existing:
                continue
            snapshot["roads"].append(
                {
                    "road_id": road["road_id"],
                    "name": road.get("name"),
                    "type": road.get("type"),
                    "status": road.get("status", road.get("initial_status", "open")),
                    "allowed_vehicle_types": road.get("allowed_vehicle_types"),
                    "restrictions": road.get("restrictions", []),
                }
            )
            added.append(road["road_id"])
        if added:
            snapshot.setdefault("provenance", []).append(
                {
                    "field": "roads",
                    "source_type": "seeded_demo",
                    "source_name": self.roads_doc.get("source_name", "scenario-roads"),
                    "retrieved_at": _utcnow_iso(),
                }
            )
            logger.info("merged %d seeded road(s) into the snapshot: %s", len(added), added)
        return snapshot

    @staticmethod
    def _revision_context(
        plan: Dict[str, Any], review: Mapping[str, Any]
    ) -> Dict[str, Any]:
        """Slim previous-plan context + safety feedback for the re-plan prompt.

        Orchestrator-level feedback channel (no agent code change): the safety
        review's objections travel VERBATIM (bounded) to the planner inside the
        previous-plan object. The context is pruned because the full plan +
        full review pushed the v2 planning prompt past the 8k window in live
        runs (vLLM 400: prompt + max_tokens > max_model_len).
        """

        def clip(items: Any, n: int = 4, width: int = 400) -> List[str]:
            return [str(item)[:width] for item in list(items or [])[:n]]

        failed_rules = [
            str(c.get("rule_id"))
            for c in review.get("rule_checks", [])
            if c.get("status") == "fail" or c.get("passed") is False
        ]
        return {
            "plan_id": plan.get("plan_id"),
            "incident_id": plan.get("incident_id"),
            "version": plan.get("version"),
            "summary": plan.get("summary"),
            "objectives": plan.get("objectives", []),
            "unit_actions": plan.get("unit_actions", []),
            "uncertainties": clip(plan.get("uncertainties"), 5),
            "safety_review_feedback": {
                "status": review.get("status"),
                "critical_objections": clip(review.get("critical_objections")),
                "required_changes": clip(review.get("required_changes")),
                "required_confirmations": clip(review.get("required_confirmations")),
                "remediation_hints": [
                    f"{rule_id}: {RULE_REMEDIATION_HINTS[rule_id]}"
                    for rule_id in failed_rules
                    if rule_id in RULE_REMEDIATION_HINTS
                ],
            },
        }

    def _approval_decision(self, plan: Mapping[str, Any]) -> Dict[str, Any]:
        """PROGRAMMATIC approval for the E2E harness (see module docstring).

        In the real demo this object is produced by the human incident
        commander through the approval UI — never automatically.
        """
        return {
            "decision_id": f"ad-{uuid.uuid4().hex[:12]}",
            "plan_id": str(plan.get("plan_id")),
            "decision": "approve",
            "operator_name": "e2e-harness",
            "operator_note": "automated E2E test approval",
            "decided_at": _utcnow_iso(),
        }

    @staticmethod
    def _tool_result_event_payload(result: Mapping[str, Any]) -> Dict[str, Any]:
        """Compact tool result payload for the event stream (no bulky data)."""
        return {
            "tool_call_id": result.get("tool_call_id"),
            "tool_name": result.get("tool_name"),
            "status": result.get("status"),
            "source_type": result.get("source_type"),
            "source_name": result.get("source_name"),
            "is_cached": result.get("is_cached"),
            "error": result.get("error"),
        }

    # ------------------------------------------------------------------ #
    # Run
    # ------------------------------------------------------------------ #

    async def run(self) -> Dict[str, Any]:
        """Execute the full pipeline for the configured audio. Returns the report."""
        t_run0 = time.perf_counter()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        item = self.manifest[self.audio_index]
        audio_rel = item[f"{self.variant}_path"]
        audio_path = REPO_ROOT / audio_rel

        self.metrics.start_incident()
        machine = self.machine
        try:
            report = await self._run_inner(item, audio_rel, audio_path)
        except PipelineFailure:
            self._write_failure_report()
            raise
        except Exception as exc:
            reason = f"{type(exc).__name__}: {exc}"
            logger.exception("pipeline failed: %s", reason)
            if not machine.is_terminal:
                machine.fail_with_fallback(reason)
            self._write_failure_report()
            raise
        finally:
            e2e_ms = self.metrics.end_incident()
            self.timings_s["e2e_total"] = round(time.perf_counter() - t_run0, 3)
            if e2e_ms is not None:
                logger.info("end-to-end: %.2f s", e2e_ms / 1000.0)
        return report

    async def _run_inner(
        self, item: Mapping[str, Any], audio_rel: str, audio_path: Path
    ) -> Dict[str, Any]:
        machine = self.machine

        # ---- intake ------------------------------------------------------
        machine.start_incident(
            {
                "scenario_id": self.units_doc.get("scenario_id"),
                "location": DEMO_LOCATION_NAME,
                "audio_id": item["audio_id"],
                "variant": self.variant,
            }
        )
        machine.receive_audio(
            {
                "audio_id": item["audio_id"],
                "variant": self.variant,
                "path": audio_rel,
                "speaker_hint": item.get("speaker_hint"),
                "scenario_timestamp": item.get("scenario_timestamp"),
            }
        )

        # ---- STT (deterministic service 2) -------------------------------
        with self._stage("stt_model_load"):
            _ = self.stt.model  # first-run model load measured separately
        machine.start_transcription(
            {"audio_id": item["audio_id"], "model": self.stt.model_name}
        )
        with self._stage("stt_transcription"):
            transcript = self.stt.transcribe(audio_path, item["audio_id"])
        transcript_dict = transcript.to_dict()
        transcript_dict["speaker_hint"] = item.get("speaker_hint")
        machine.transcript_ready(
            {
                "audio_id": transcript.audio_id,
                "text": transcript.text,
                "language": transcript.language,
                "latency_ms": transcript.latency_ms,
                "model_name": transcript.model_name,
                "fallback_used": transcript.fallback_used,
            }
        )

        # ---- Agent 1: Radio Intelligence ---------------------------------
        with self._stage("radio_intelligence"):
            extraction = await self.radio_agent.extract(transcript_dict)
        radio_events = [dict(e) for e in extraction.events]
        for event in radio_events:
            machine.record_radio_event(dict(event))
        if not radio_events:
            machine.fail_with_fallback("radio intelligence extracted zero events")
            raise PipelineFailure("radio intelligence extracted zero events")

        # ---- Agent 2: Situation Context (real tool layer) ----------------
        machine.start_context_collection({"agent": "situation_context"})
        machine.complete_radio_extraction()

        incident_ctx = self._incident_ctx()
        with self._stage("context_tool_selection"):
            selection = await self.context_agent.select_tools(incident_ctx, radio_events)
        requests = list(selection.requests)
        if not requests:
            # Deterministic fallback: the planning gate needs >= 1 tool result.
            logger.warning(
                "model selected no tools; falling back to deterministic requests %s",
                FALLBACK_CONTEXT_TOOLS,
            )
            requests = [
                self.tool_executor.build_request(
                    "situation_context",
                    name,
                    {},
                    reason="deterministic fallback: model selected no tools",
                )
                for name in FALLBACK_CONTEXT_TOOLS
            ]
        for request in requests:
            machine.record_tool_call(
                {
                    "tool_call_id": request["tool_call_id"],
                    "tool_name": request["tool_name"],
                    "arguments": request["arguments"],
                    "reason": request.get("reason"),
                }
            )
        with self._stage("context_tool_execution"):
            tool_results = self.context_agent.execute_tools(requests)
        for result in tool_results:
            machine.record_tool_result(self._tool_result_event_payload(result))
        machine.complete_context_collection()

        with self._stage("situation_snapshot"):
            snapshot = await self.context_agent.build_snapshot(
                incident_ctx, radio_events, tool_results
            )
        snapshot = self._merge_seeded_roads(snapshot)
        machine.submit_situation_snapshot(dict(snapshot))

        # ---- Agent 3 + 4: plan -> safety review (bounded revision loop) ---
        plans: List[Dict[str, Any]] = []
        reviews: List[Dict[str, Any]] = []
        self._debug_plans = plans
        self._debug_reviews = reviews
        self._debug_snapshot = snapshot

        with self._stage("tactical_planning_v1"):
            plan = await self.planning_agent.draft_plan(
                radio_events, snapshot, self.units_doc
            )
        plans.append(plan.to_dict())
        machine.submit_draft_plan(plan.to_dict())

        with self._stage("safety_review_v1"):
            review = await self.safety_agent.review(dict(plan), snapshot, self.unit_list)
        reviews.append(review)
        machine.complete_safety_review(SafetyReviewStatus(review["status"]), dict(review))

        revision = 0
        while review["status"] != "pass" and revision < self.max_revisions:
            revision += 1
            previous = self._revision_context(plan.to_dict(), review)
            with self._stage(f"tactical_planning_v{revision + 1}"):
                plan = await self.planning_agent.draft_plan(
                    radio_events, snapshot, self.units_doc, previous_plan=previous
                )
            plans.append(plan.to_dict())
            machine.submit_draft_plan(plan.to_dict())
            with self._stage(f"safety_review_v{revision + 1}"):
                review = await self.safety_agent.review(
                    dict(plan), snapshot, self.unit_list
                )
            reviews.append(review)
            machine.complete_safety_review(
                SafetyReviewStatus(review["status"]), dict(review)
            )

        if review["status"] != "pass":
            reason = (
                f"safety review still '{review['status']}' after "
                f"{revision} revision(s) — refusing to fake a pass"
            )
            machine.fail_with_fallback(reason)
            raise PipelineFailure(reason)

        # ---- human approval gate (programmatic for the E2E harness) -------
        decision = self._approval_decision(plan)
        machine.record_approval_decision(ApprovalDecision.APPROVE, dict(decision))

        # ---- Agent 5: Dispatch (only after approval) ----------------------
        machine.start_dispatch({"plan_id": plan["plan_id"]})
        with self._stage("dispatch_generation"):
            instructions = await self.dispatch_agent.generate(
                dict(plan), decision, self.units_doc
            )
        for instruction in instructions:
            machine.record_dispatch_instruction(dict(instruction))

        # ---- Piper TTS (deterministic service 5) --------------------------
        machine.record_tts_started(
            {
                "engine": "piper",
                "voice_available": self.tts.available,
                "instruction_count": len(instructions),
            }
        )
        tts_results: List[Dict[str, Any]] = []
        with self._stage("tts"):
            for instruction in instructions:
                filename = (
                    f"{self.incident_id}_{instruction['dispatch_id']}_"
                    f"{instruction['unit_id']}.wav"
                )
                result = self.tts.synthesize(instruction["message_text"], filename)
                if result["status"] == "success":
                    instruction["tts_audio_path"] = result["wav_path"]
                    instruction["dispatch_status"] = "ready"
                else:
                    # Documented text-only fallback: message stays dispatchable.
                    instruction["dispatch_status"] = "ready"
                tts_results.append(
                    {
                        "dispatch_id": instruction["dispatch_id"],
                        "unit_id": instruction["unit_id"],
                        **result,
                    }
                )
                machine.record_tts_ready(
                    {
                        "dispatch_id": instruction["dispatch_id"],
                        "unit_id": instruction["unit_id"],
                        "status": result["status"],
                        "wav_path": result.get("wav_path"),
                        "latency_ms": result.get("latency_ms"),
                    }
                )

        wav_count = sum(1 for r in tts_results if r["status"] == "success")
        for instruction in instructions:
            instruction["dispatch_status"] = "sent"
        machine.mark_dispatched(
            {"instruction_count": len(instructions), "wav_count": wav_count}
        )
        machine.complete_incident(
            {
                "audio_id": item["audio_id"],
                "plan_id": plan["plan_id"],
                "instructions": len(instructions),
                "wavs": wav_count,
            }
        )

        return self._build_report(
            item=item,
            audio_rel=audio_rel,
            transcript=transcript_dict,
            extraction=extraction,
            selection_rejected=[r.__dict__ for r in selection.rejected],
            requests=requests,
            tool_results=tool_results,
            snapshot=snapshot,
            plans=plans,
            reviews=reviews,
            decision=decision,
            instructions=instructions,
            tts_results=tts_results,
        )

    # ------------------------------------------------------------------ #
    # Report
    # ------------------------------------------------------------------ #

    def _write_failure_report(self) -> None:
        """Dump everything produced so far when the run cannot complete."""
        try:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            path = self.output_dir / f"{self.incident_id}_FAILURE.json"
            payload = {
                "incident_id": self.incident_id,
                "generated_at": _utcnow_iso(),
                "final_state": self.machine.state.value,
                "timings_s": dict(self.timings_s),
                "snapshot": getattr(self, "_debug_snapshot", None),
                "plans": getattr(self, "_debug_plans", []),
                "safety_reviews": getattr(self, "_debug_reviews", []),
                "events": [e.to_dict() for e in self.machine.emitted_events],
                "per_agent_llm": self._per_agent_latency(),
            }
            path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            logger.error("failure report written: %s", path)
        except Exception:  # noqa: BLE001 — diagnostics must never mask the real error
            logger.exception("could not write the failure report")

    def _per_agent_latency(self) -> Dict[str, Dict[str, Any]]:
        agg: Dict[str, Dict[str, Any]] = {}
        for record in self.call_log.records():
            entry = agg.setdefault(
                record.agent or "unattributed",
                {
                    "calls": 0,
                    "failures": 0,
                    "latency_s_total": 0.0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                },
            )
            entry["calls"] += 1
            entry["failures"] += 0 if record.success else 1
            entry["latency_s_total"] = round(
                entry["latency_s_total"] + record.latency_s, 3
            )
            entry["prompt_tokens"] += record.prompt_tokens
            entry["completion_tokens"] += record.completion_tokens
        return agg

    def _feed_metrics(self) -> None:
        records = self.call_log.records()
        peak = max(1, self.call_log.max_concurrent)
        for index, record in enumerate(records):
            self.metrics.record_call(
                latency_ms=record.latency_s * 1000.0,
                tokens_in=record.prompt_tokens or None,
                tokens_out=record.completion_tokens or None,
                concurrent=peak if index == len(records) - 1 else 1,
            )
        for _ in range(self.call_log.cloud_calls):
            self.metrics.record_cloud_call()

    def _validate_events(self) -> Dict[str, Any]:
        errors: List[str] = []
        envelopes = [e.to_dict() for e in self.machine.emitted_events]
        for envelope in envelopes:
            for err in self._envelope_validator.iter_errors(envelope):
                errors.append(f"{envelope.get('event_id')}: {err.message}")
        return {
            "total_events": len(envelopes),
            "contract_valid": len(errors) == 0,
            "errors": errors,
        }

    def _build_report(self, **kw: Any) -> Dict[str, Any]:
        self._feed_metrics()
        audit_path = self.output_dir / f"{self.incident_id}_tool_audit.jsonl"
        self.audit_log.export_jsonl(audit_path)

        extraction = kw["extraction"]
        report: Dict[str, Any] = {
            "incident_id": self.incident_id,
            "generated_at": _utcnow_iso(),
            "final_state": self.machine.state.value,
            "audio": {
                "audio_id": kw["item"]["audio_id"],
                "variant": self.variant,
                "path": kw["audio_rel"],
                "speaker_hint": kw["item"].get("speaker_hint"),
                "reference_transcript": kw["item"].get("reference_transcript"),
            },
            "timings_s": dict(self.timings_s),
            "transcript": kw["transcript"],
            "radio_extraction": {
                "events": [dict(e) for e in extraction.events],
                "confidence": extraction.confidence,
                "uncertainties": list(extraction.uncertainties),
                "proposed_tool_calls": [
                    tc.model_dump() for tc in extraction.proposed_tool_calls
                ],
                "structured_output_attempts": extraction.attempts,
            },
            "context": {
                "tool_requests": [dict(r) for r in kw["requests"]],
                "rejected_tool_calls": kw["selection_rejected"],
                "tool_results": [
                    self._tool_result_event_payload(r) for r in kw["tool_results"]
                ],
                "snapshot": kw["snapshot"],
            },
            "plans": kw["plans"],
            "safety_reviews": kw["reviews"],
            "approval_decision": kw["decision"],
            "dispatch_instructions": [dict(i) for i in kw["instructions"]],
            "tts": kw["tts_results"],
            "events": [e.to_dict() for e in self.machine.emitted_events],
            "event_contract_validation": self._validate_events(),
            "per_agent_llm": self._per_agent_latency(),
            "llm_call_log": {
                "total_calls": self.call_log.total_calls,
                "successes": self.call_log.successes,
                "failures": self.call_log.failures,
                "cloud_calls": self.call_log.cloud_calls,
                "max_concurrent": self.call_log.max_concurrent,
            },
            "metrics": self.metrics.snapshot(),
            "tool_audit_jsonl": str(audit_path),
        }
        return report

    async def aclose(self) -> None:
        await self.client.aclose()
