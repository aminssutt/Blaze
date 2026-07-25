"""BLAZE scenario pipeline — REAL end-to-end run over ALL FIVE audios (issue #53).

Extends the single-audio :class:`IncidentPipeline` (#52) to the full seeded
scenario with three explicit properties:

1. **Concurrency** — the five audios are transcribed CONCURRENTLY from t=0
   (batch STT of #12, one loaded model, thread fan-out) and the context
   collection (tool selection + execution) runs in PARALLEL with the radio
   track. Both overlaps are MEASURED and reported (wall windows + the
   sequential-sum comparison), never asserted.

2. **Scenario order** — radio events are PROCESSED strictly in
   ``scenario_timestamp`` order (audio_01 .. audio_05) regardless of the
   order in which the concurrent transcriptions complete.

3. **Budgeted incremental planning** (target: full scenario < 5 min) —
   the LLM planner runs at exactly THREE moments:

   a. plan cycle A after audios 1-2 + situation snapshot;
   b. re-plan cycle B after audio 4 (the D17 CORRECTION, linked via
      ``corrects_event_id`` — the state is updated, never duplicated);
   c. final plan cycle C after audio 5 (explosions CONFIRMED as suspected
      gas cylinders -> exclusion perimeter required by ``sr-hazmat-perimeter``).

   Audio 3 (wind shift) only updates the snapshot/state — NO re-plan.
   Each cycle has a revise-cap of 1 (default): one revision, then the
   escalation-to-human policy of #52 applies (residual LLM objections attach
   to the approval request; a mechanical ``block`` is never escalated).

Every step drives the deterministic :class:`IncidentStateMachine`; mid-incident
radio traffic uses the additive self-transitions ``record_radio_update`` /
``update_situation_snapshot`` (issue #53) which cannot bypass any safety
property: every new plan version still passes SAFETY_REVIEW and the
AWAITING_HUMAN_APPROVAL gate, and dispatch remains reachable only from
APPROVED.

Deterministic state updates (orchestrator-owned, radio-sourced, provenance
``human_report``): the wind shift (audio 3), the D17 correction (audio 4) and
the hazard confirmation (audio 5) are precise, structured radio facts — the
orchestrator applies them to the authoritative snapshot deterministically
(cheaper AND safer than an LLM rebuild that could fuse or duplicate entries),
appending provenance instead of erasing history.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Mapping, Optional

from backend.orchestrator.incident_pipeline import (
    FALLBACK_CONTEXT_TOOLS,
    IncidentPipeline,
    PipelineFailure,
    _utcnow_iso,
)
from backend.state.machine import ApprovalDecision, SafetyReviewStatus

logger = logging.getLogger("blaze.scenario")

DEFAULT_MAX_REVISIONS_PER_CYCLE = 1


class ScenarioPipeline(IncidentPipeline):
    """Full 5-audio scenario run (see module docstring)."""

    def __init__(
        self,
        *,
        variant: str = "radio",
        output_dir=None,
        max_revisions_per_cycle: int | None = None,
        incident_id: str | None = None,
    ) -> None:
        super().__init__(
            audio_index=0,
            variant=variant,
            output_dir=output_dir,
            max_revisions=(
                max_revisions_per_cycle
                if max_revisions_per_cycle is not None
                else DEFAULT_MAX_REVISIONS_PER_CYCLE
            ),
            incident_id=incident_id,
        )
        # Scenario order is the manifest order; make the invariant explicit.
        self.items: List[Dict[str, Any]] = sorted(
            (dict(i) for i in self.manifest),
            key=lambda i: i.get("scenario_timestamp", 0),
        )
        # Measured wall-clock windows (offsets from run start, seconds).
        self.windows: Dict[str, Dict[str, float]] = {}
        self._t_run0: float = 0.0

        # Collected artifacts for the report.
        self.transcripts: Dict[str, Dict[str, Any]] = {}
        self.extractions: Dict[str, Any] = {}
        self.all_radio_events: List[Dict[str, Any]] = []
        self.plans: List[Dict[str, Any]] = []
        self.reviews: List[Dict[str, Any]] = []
        self.cycles: List[Dict[str, Any]] = []
        self.snapshot_updates: List[Dict[str, Any]] = []
        self.processed_order: List[Dict[str, Any]] = []
        self.stt_completion_offsets: Dict[str, float] = {}
        # Parent failure-report hooks (shared lists, populated as we go).
        self._debug_plans = self.plans
        self._debug_reviews = self.reviews
        self._tts_latencies: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------ #
    # Wall-clock windows
    # ------------------------------------------------------------------ #

    def _now_off(self) -> float:
        return round(time.perf_counter() - self._t_run0, 3)

    def _open_window(self, name: str) -> None:
        self.windows[name] = {"start_s": self._now_off()}

    def _close_window(self, name: str) -> None:
        w = self.windows.setdefault(name, {"start_s": self._now_off()})
        w["end_s"] = self._now_off()
        w["duration_s"] = round(w["end_s"] - w["start_s"], 3)

    @staticmethod
    def _overlap(a: Mapping[str, float], b: Mapping[str, float]) -> float:
        lo = max(a.get("start_s", 0.0), b.get("start_s", 0.0))
        hi = min(a.get("end_s", 0.0), b.get("end_s", 0.0))
        return round(max(0.0, hi - lo), 3)

    # ------------------------------------------------------------------ #
    # Deterministic snapshot updates (radio-sourced, provenance kept)
    # ------------------------------------------------------------------ #

    def _register_events(self, snapshot: Dict[str, Any], events: List[Dict[str, Any]]) -> None:
        ids = snapshot.setdefault("radio_events", [])
        for e in events:
            if e.get("event_id") and e["event_id"] not in ids:
                ids.append(e["event_id"])

    def _bump(self, snapshot: Dict[str, Any], field: str, audio_id: str, note: str) -> None:
        snapshot["version"] = int(snapshot.get("version", 1)) + 1
        snapshot["generated_at"] = _utcnow_iso()
        snapshot.setdefault("provenance", []).append(
            {
                "field": field,
                "source_type": "human_report",
                "source_name": f"radio {audio_id}: {note}"[:200],
                "retrieved_at": _utcnow_iso(),
            }
        )

    def _apply_wind_update(
        self, snapshot: Dict[str, Any], events: List[Dict[str, Any]], audio_id: str
    ) -> Dict[str, Any]:
        """Audio 3 — wind shift: snapshot/state update ONLY (no re-plan)."""
        facts = [f for e in events for f in e.get("facts", [])]
        weather = dict(snapshot.get("weather") or {})
        weather["radio_wind_update"] = {
            "source_audio": audio_id,
            "direction": "south-east (turning)",
            "trend": "speed increasing strongly",
            "consequence": "fire now progressing toward the D17",
            "reported_facts": facts[:6],
        }
        snapshot["weather"] = weather
        snapshot.setdefault("known_facts", []).append(
            "Wind has shifted to the south-east and is strengthening; the fire "
            f"is progressing toward the D17 (radio {audio_id})."
        )
        self._register_events(snapshot, events)
        self._bump(snapshot, "weather", audio_id, "wind shift update")
        return {"update": "wind", "audio_id": audio_id, "facts_used": facts[:6]}

    def _apply_d17_correction(
        self, snapshot: Dict[str, Any], events: List[Dict[str, Any]], audio_id: str
    ) -> Dict[str, Any]:
        """Audio 4 — the correction UPDATES the D17 entry (never duplicates it).

        History preservation: the original radio event stays in the event
        stream and in ``snapshot['radio_events']``; superseded free-text facts
        are recorded in the returned verification dict (and in the report),
        and the road entry keeps an audit note instead of being replaced.
        """
        correction = next((e for e in events if e.get("is_correction")), None)
        corrects_id = correction.get("corrects_event_id") if correction else None

        roads = snapshot.setdefault("roads", [])
        d17_entries = [
            r for r in roads
            if isinstance(r, Mapping) and "d17" in str(r.get("road_id", "")).lower()
            or isinstance(r, Mapping) and "d17" in str(r.get("name", "")).lower()
        ]
        # Never duplicate: keep the FIRST D17 entry, drop model-side duplicates.
        removed_duplicates = 0
        if len(d17_entries) > 1:
            keep = d17_entries[0]
            for extra in d17_entries[1:]:
                roads.remove(extra)
                removed_duplicates += 1
            d17_entries = [keep]
        if not d17_entries:
            entry: Dict[str, Any] = {"road_id": "d17", "name": "Route D17"}
            roads.append(entry)
        else:
            entry = d17_entries[0]  # type: ignore[assignment]

        status_before = entry.get("status")
        entry["status"] = "restricted"
        # Structured restriction objects — the rule engine's
        # check_vehicle_road_compatibility reads {vehicle_type, reason} dicts
        # (live finding #53 run 3: a free-text string here crashes the review).
        restrictions = [
            r for r in (entry.get("restrictions") or []) if isinstance(r, Mapping)
        ]
        restrictions.append(
            {
                "vehicle_type": "CCF",
                "reason": (
                    "CORRECTED (radio audio_04): D17 not fully blocked — "
                    "impassable for heavy trucks (CCF); light vehicles can "
                    "still pass via the north side"
                ),
            }
        )
        entry["restrictions"] = restrictions
        entry["corrected_by_event"] = correction.get("event_id") if correction else None
        entry["corrects_event_id"] = corrects_id

        # Supersede stale D17 free-text facts (recorded, not silently erased).
        superseded: List[str] = []
        for key in ("known_facts", "uncertain_facts"):
            kept = []
            for fact in snapshot.get(key) or []:
                text = str(fact).lower()
                if "d17" in text and ("block" in text or "bloqu" in text):
                    superseded.append(f"{key}: {fact}")
                else:
                    kept.append(fact)
            snapshot[key] = kept
        snapshot.setdefault("known_facts", []).append(
            "CORRECTION (radio audio_04): the D17 is NOT fully blocked — it stays "
            "impassable for heavy trucks, but light vehicles can pass via the "
            "north side."
        )
        self._register_events(snapshot, events)
        self._bump(
            snapshot, "roads[d17]", audio_id,
            f"D17 correction (corrects_event_id={corrects_id})",
        )
        return {
            "update": "d17_correction",
            "audio_id": audio_id,
            "is_correction": bool(correction),
            "correction_event_id": correction.get("event_id") if correction else None,
            "corrects_event_id": corrects_id,
            "d17_status_before": status_before,
            "d17_status_after": entry["status"],
            "d17_entries_in_snapshot": sum(
                1 for r in roads
                if isinstance(r, Mapping) and "d17" in str(r.get("road_id", "")).lower()
            ),
            "model_duplicates_removed": removed_duplicates,
            "superseded_facts": superseded,
        }

    def _apply_hazard_confirmation(
        self, snapshot: Dict[str, Any], events: List[Dict[str, Any]], audio_id: str
    ) -> Dict[str, Any]:
        """Audio 5 — explosions reported (audio 1) become CONFIRMED hazmat."""
        snapshot.setdefault("known_facts", []).append(
            "CONFIRMED (radio audio_05): the explosions originate from behind the "
            "hangar; gas cylinders (hazardous material) are suspected on site — "
            "the area must be treated as dangerous."
        )
        snapshot.setdefault("critical_assets", []).append(
            {
                "asset_id": "hangar-gas-cylinders",
                "type": "hazmat",
                "name": "Suspected gas cylinders behind the hangar",
                "description": (
                    "Visual confirmation (Bravo 2): explosions come from behind "
                    "the hangar, suspected gas cylinders — dangerous area."
                ),
                "confirmed": True,
            }
        )
        self._register_events(snapshot, events)
        self._bump(snapshot, "critical_assets", audio_id, "explosions confirmed as suspected gas cylinders")
        return {"update": "hazard_confirmation", "audio_id": audio_id}

    # ------------------------------------------------------------------ #
    # Planning cycle (revise-cap per cycle + escalation policy of #52)
    # ------------------------------------------------------------------ #

    def _replan_context(
        self,
        plan: Mapping[str, Any],
        reason: str,
        new_events: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Slim previous-plan context for an incremental re-plan (new intel)."""
        return {
            "plan_id": plan.get("plan_id"),
            "incident_id": plan.get("incident_id"),
            "version": plan.get("version"),
            "summary": plan.get("summary"),
            "objectives": [str(o)[:220] for o in plan.get("objectives", [])[:5]],
            "unit_actions": [
                {
                    key: action.get(key)
                    for key in (
                        "action_id", "unit_id", "action_type", "route",
                        "objective", "summary", "human_approval_required",
                    )
                    if key in action
                }
                for action in plan.get("unit_actions", [])
                if isinstance(action, Mapping)
            ],
            "replan_reason": reason,
            "new_radio_events": [
                {
                    "event_id": e.get("event_id"),
                    "event_type": e.get("event_type"),
                    "is_correction": e.get("is_correction"),
                    "corrects_event_id": e.get("corrects_event_id"),
                    "facts": e.get("facts", [])[:6],
                }
                for e in new_events
            ],
        }

    async def _planning_cycle(
        self,
        cycle: str,
        snapshot: Dict[str, Any],
        previous_context: Optional[Dict[str, Any]] = None,
    ) -> tuple[Any, bool]:
        """One budgeted plan->review cycle. Machine must be in DRAFTING_PLAN or
        REVISING_PLAN. Ends in AWAITING_HUMAN_APPROVAL (pass or escalated
        revise) or raises on a persistent mechanical block."""
        machine = self.machine
        cycle_info: Dict[str, Any] = {"cycle": cycle, "plan_versions": [], "reviews": []}
        self.cycles.append(cycle_info)

        planner_snapshot = self._planner_snapshot(snapshot)
        with self._stage(f"planning_{cycle}_v1"):
            plan = await self.planning_agent.draft_plan(
                self._planner_events(), planner_snapshot, self.units_doc,
                previous_plan=previous_context,
            )
        self.plans.append(plan.to_dict())
        machine.submit_draft_plan(plan.to_dict())
        cycle_info["plan_versions"].append(machine.plan_version)

        with self._stage(f"safety_review_{cycle}_v1"):
            review = await self.safety_agent.review(dict(plan), snapshot, self.unit_list)
        self.reviews.append(review)
        cycle_info["reviews"].append(review.get("status"))

        revision = 0
        escalated = False
        while True:
            status = SafetyReviewStatus(review["status"])
            if status is SafetyReviewStatus.PASS:
                machine.complete_safety_review(status, dict(review))
                break
            if revision >= self.max_revisions:
                if status is SafetyReviewStatus.REVISE:
                    machine.complete_safety_review(status, dict(review), escalate_to_human=True)
                    escalated = True
                    logger.warning(
                        "cycle %s: still 'revise' after %d revision(s) — escalated "
                        "to the human gate with %d residual objection(s)",
                        cycle, revision, len(review.get("critical_objections", [])),
                    )
                    break
                machine.complete_safety_review(status, dict(review))
                reason = (
                    f"cycle {cycle}: safety review still '{review['status']}' after "
                    f"{revision} revision(s) — a mechanical block is never escalated"
                )
                machine.fail_with_fallback(reason)
                raise PipelineFailure(reason)
            machine.complete_safety_review(status, dict(review))
            revision += 1
            previous = self._revision_context(plan.to_dict(), review)
            with self._stage(f"planning_{cycle}_v{revision + 1}"):
                plan = await self.planning_agent.draft_plan(
                    self._planner_events(), planner_snapshot, self.units_doc,
                    previous_plan=previous,
                )
            self.plans.append(plan.to_dict())
            machine.submit_draft_plan(plan.to_dict())
            cycle_info["plan_versions"].append(machine.plan_version)
            with self._stage(f"safety_review_{cycle}_v{revision + 1}"):
                review = await self.safety_agent.review(dict(plan), snapshot, self.unit_list)
            self.reviews.append(review)
            cycle_info["reviews"].append(review.get("status"))
        cycle_info["escalated_to_human"] = escalated
        cycle_info["revisions_used"] = revision
        return plan, escalated

    # ------------------------------------------------------------------ #
    # Radio extraction — CONCURRENT inference, scenario-order processing
    # ------------------------------------------------------------------ #
    #
    # vLLM continuous batching on the L40S handles concurrent requests, so the
    # radio-intelligence INFERENCE runs concurrently while the downstream
    # PROCESSING (state machine events, corrections via corrects_event_id,
    # snapshot updates, re-planning) stays strictly in scenario_timestamp
    # order. Correction resolution consults the radio agent's recent_context,
    # so the extraction runs in DEPENDENCY WAVES: audios 1-3 together (none is
    # a correction), then audios 4-5 together once the wave-1 events are in
    # the linking context (audio_04 is the correction and needs audios 1-3;
    # audio_05 is a confirmation, not a correction — it never consults the
    # linking context, so it can share the second wave). Wave 2 runs
    # concurrently with the snapshot build + planning cycle A.

    @staticmethod
    def _slim_event(event: Mapping[str, Any]) -> Dict[str, Any]:
        """Compact RadioEvent view for the planner prompt (8k window budget).

        Live finding (#53, run 1): the full event dicts (evidence_text,
        uncertainties, timestamps) pushed the cycle-A revision prompt past the
        8k window (HTTP 400). The planner only needs identity, typing, links
        and facts; validation still runs on the FULL events upstream.
        """
        slim = {
            key: event.get(key)
            for key in (
                "event_id", "audio_id", "event_type", "unit_id",
                "location_reference", "is_correction", "corrects_event_id",
                "confidence",
            )
        }
        slim["facts"] = [str(f) for f in (event.get("facts") or [])][:6]
        return slim

    def _planner_events(self) -> List[Dict[str, Any]]:
        return [self._slim_event(e) for e in self.all_radio_events]

    @staticmethod
    def _planner_snapshot(snapshot: Mapping[str, Any]) -> Dict[str, Any]:
        """Compact snapshot view for the PLANNER prompt only (8k window budget).

        Live finding (#53, run 2): by planning cycle B the authoritative
        snapshot (wind update + D17 correction + provenance trail) no longer
        fits the planner prompt (HTTP 400). The planner does not need the
        provenance trail or the event-id ledger; free-text lists are bounded
        keeping the MOST RECENT entries (corrections/confirmations are appended
        last). The safety critic and the report keep the FULL snapshot.
        """
        import copy

        slim = copy.deepcopy(dict(snapshot))
        slim.pop("provenance", None)
        slim.pop("radio_events", None)
        for key in ("known_facts", "uncertain_facts", "conflicts", "missing_information"):
            slim[key] = [str(x)[:220] for x in (slim.get(key) or [])[-10:]]
        weather = slim.get("weather")
        if isinstance(weather, dict) and isinstance(weather.get("radio_wind_update"), dict):
            weather["radio_wind_update"].pop("reported_facts", None)
        for key in ("buildings_and_parcels", "fire_hotspots"):
            value = slim.get(key)
            if isinstance(value, list) and len(value) > 6:
                slim[key] = value[:6]
        slim["roads"] = [
            {
                key: road.get(key)
                for key in (
                    "road_id", "name", "status", "allowed_vehicle_types",
                    "restrictions", "corrected_by_event", "corrects_event_id",
                )
                if key in road
            }
            for road in slim.get("roads") or []
            if isinstance(road, Mapping)
        ]
        return slim

    _BULKY_TOOL_KEYS = ("geometry", "points", "coordinates", "polyline", "path", "steps")

    def _planner_tool_call(self, tool_name, arguments):  # type: ignore[override]
        """Parent behavior + geometry pruning (8k window budget, issue #53).

        Tool-round results are appended verbatim to the planner messages; a
        routed geometry (hundreds of points) can push the FINAL generation or
        its repair attempt past the window. The planner consumes road ids,
        distances and statuses — never raw polylines — so bulky coordinate
        arrays are replaced by a count marker. The audit log keeps the full
        result (pruning happens on the returned copy only).
        """
        import copy
        import json as _json

        result = super()._planner_tool_call(tool_name, arguments)
        try:
            if len(_json.dumps(result, default=str)) <= 1500:
                return result
            pruned = copy.deepcopy(dict(result))

            def _prune(node: Any) -> Any:
                if isinstance(node, dict):
                    return {
                        k: (
                            f"<pruned: {len(v)} points>"
                            if k in self._BULKY_TOOL_KEYS and isinstance(v, (list, str))
                            else _prune(v)
                        )
                        for k, v in node.items()
                    }
                if isinstance(node, list):
                    return [_prune(item) for item in node[:20]]
                return node

            return _prune(pruned)
        except Exception:  # pragma: no cover — never break the tool round
            return result

    def _revision_context(self, plan, review):  # type: ignore[override]
        """Parent revision context with slimmed unit actions (8k budget)."""
        context = super()._revision_context(plan, review)
        context["unit_actions"] = [
            {
                key: action.get(key)
                for key in (
                    "action_id", "unit_id", "action_type", "route",
                    "objective", "summary", "human_approval_required",
                )
                if key in action
            }
            for action in context.get("unit_actions", [])
            if isinstance(action, Mapping)
        ]
        return context

    async def _infer_audio(self, item: Mapping[str, Any]) -> None:
        """Radio-intelligence INFERENCE only (no state machine calls) —
        safe to run concurrently with other LLM work."""
        audio_id = item["audio_id"]
        self._open_window(f"extract_{audio_id}")
        with self._stage(f"radio_intelligence_{audio_id}"):
            extraction = await self.radio_agent.extract(self.transcripts[audio_id])
        self._close_window(f"extract_{audio_id}")
        self.extractions[audio_id] = extraction

    def _process_extraction(self, item: Mapping[str, Any], *, late: bool) -> List[Dict[str, Any]]:
        """Scenario-order PROCESSING of a completed extraction (state machine
        events + incident state) — always called in scenario_timestamp order."""
        audio_id = item["audio_id"]
        extraction = self.extractions[audio_id]
        events = [dict(e) for e in extraction.events]
        for event in events:
            if late:
                self.machine.record_radio_update(dict(event))
            else:
                self.machine.record_radio_event(dict(event))
        self.all_radio_events.extend(events)
        self.processed_order.append(
            {
                "audio_id": audio_id,
                "scenario_timestamp": item.get("scenario_timestamp"),
                "processed_at_s": self._now_off(),
                "events": [e.get("event_id") for e in events],
                "event_types": [e.get("event_type") for e in events],
            }
        )
        return events

    # ------------------------------------------------------------------ #
    # Run
    # ------------------------------------------------------------------ #

    async def run(self) -> Dict[str, Any]:  # type: ignore[override]
        self._t_run0 = time.perf_counter()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.metrics.start_incident()
        machine = self.machine
        try:
            report = await self._run_scenario()
        except PipelineFailure:
            self._write_failure_report()
            raise
        except Exception as exc:  # noqa: BLE001
            reason = f"{type(exc).__name__}: {exc}"
            logger.exception("scenario pipeline failed: %s", reason)
            if not machine.is_terminal:
                machine.fail_with_fallback(reason)
            self._write_failure_report()
            raise
        finally:
            self.metrics.end_incident()
            self.timings_s["scenario_total"] = self._now_off()
        return report

    async def _run_scenario(self) -> Dict[str, Any]:
        machine = self.machine
        loop = asyncio.get_running_loop()

        # ---- intake: ALL five audios announced up-front -------------------
        machine.start_incident(
            {
                "scenario_id": self.units_doc.get("scenario_id"),
                "location": "Frontignan / Massif de la Gardiole (Herault, France)",
                "audio_count": len(self.items),
                "variant": self.variant,
                "mode": "full_scenario_5_audios",
            }
        )
        for item in self.items:
            machine.receive_audio(
                {
                    "audio_id": item["audio_id"],
                    "variant": self.variant,
                    "path": item[f"{self.variant}_path"],
                    "speaker_hint": item.get("speaker_hint"),
                    "scenario_timestamp": item.get("scenario_timestamp"),
                }
            )

        # ---- CONCURRENT batch STT (all 5 from t=0, one loaded model) ------
        with self._stage("stt_model_load"):
            _ = self.stt.model
        machine.start_transcription(
            {
                "audio_ids": [i["audio_id"] for i in self.items],
                "model": self.stt.model_name,
                "mode": "concurrent_batch",
            }
        )
        futures: Dict[str, asyncio.Future] = {
            i["audio_id"]: loop.create_future() for i in self.items
        }
        stt_t0 = time.perf_counter()

        def _on_result(result) -> None:  # worker thread -> loop
            self.stt_completion_offsets[result.audio_id] = round(
                time.perf_counter() - stt_t0, 3
            )
            loop.call_soon_threadsafe(
                lambda r=result: futures[r.audio_id].done() or futures[r.audio_id].set_result(r)
            )

        self._open_window("stt_batch")
        stt_task = asyncio.create_task(
            asyncio.to_thread(
                self.stt.transcribe_batch, self.items, self.variant, None, _on_result
            )
        )

        speaker_hints = {i["audio_id"]: i.get("speaker_hint") for i in self.items}

        async def _await_transcript(audio_id: str) -> Dict[str, Any]:
            result = await futures[audio_id]
            d = result.to_dict()
            d["speaker_hint"] = speaker_hints.get(audio_id)
            self.transcripts[audio_id] = d
            machine.transcript_ready(
                {
                    "audio_id": result.audio_id,
                    "text": result.text,
                    "language": result.language,
                    "latency_ms": result.latency_ms,
                    "model_name": result.model_name,
                    "fallback_used": result.fallback_used,
                }
            )
            return d

        # ---- WAVE 1: audios 1-3 extracted CONCURRENTLY ---------------------
        # (none is a correction, so none consults the linking context)
        async def _wave1(item: Mapping[str, Any]) -> None:
            await _await_transcript(item["audio_id"])
            await self._infer_audio(item)

        wave1 = {
            item["audio_id"]: asyncio.create_task(_wave1(item))
            for item in self.items[:3]
        }
        await wave1["audio_01"]
        events_1 = self._process_extraction(self.items[0], late=False)
        if not events_1:
            machine.fail_with_fallback("radio intelligence extracted zero events for audio_01")
            raise PipelineFailure("radio intelligence extracted zero events for audio_01")
        self.radio_agent.recent_context.extend(events_1)

        # ---- context collection IN PARALLEL with the radio track -----------
        machine.start_context_collection({"agent": "situation_context", "parallel_with": "stt+radio"})
        incident_ctx = self._incident_ctx()
        ctx_holder: Dict[str, Any] = {}

        async def _context_track() -> None:
            self._open_window("context_collection")
            with self._stage("context_tool_selection"):
                selection = await self.context_agent.select_tools(incident_ctx, list(events_1))
            requests = list(selection.requests)
            if not requests:
                logger.warning("model selected no tools; deterministic fallback %s", FALLBACK_CONTEXT_TOOLS)
                requests = [
                    self.tool_executor.build_request(
                        "situation_context", name, {},
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
            self._close_window("context_collection")
            ctx_holder.update(
                selection=selection, requests=requests, tool_results=tool_results
            )

        async def _radio_wave1_rest() -> None:
            self._open_window("radio_track_intake")
            await asyncio.gather(wave1["audio_02"], wave1["audio_03"])
            self._close_window("radio_track_intake")

        await asyncio.gather(_context_track(), _radio_wave1_rest())
        events_2 = self._process_extraction(self.items[1], late=False)
        self.radio_agent.recent_context.extend(events_2)
        # audio_03 joins the LINKING context now (scenario order); its incident
        # processing happens at its narrative moment, after planning cycle A.
        self.radio_agent.recent_context.extend(
            [dict(e) for e in self.extractions["audio_03"].events]
        )

        # Whole batch done (it overlapped the radio/context work above).
        batch_results = await stt_task
        self._close_window("stt_batch")
        for item in self.items[3:]:
            await _await_transcript(item["audio_id"])
        machine.complete_radio_extraction()

        # ---- WAVE 2: audios 4-5 extracted CONCURRENTLY with the snapshot ---
        # build + planning cycle A (audio_04 needs audios 1-3 in the linking
        # context — available now; audio_05 is not a correction).
        wave2 = {
            item["audio_id"]: asyncio.create_task(self._infer_audio(item))
            for item in self.items[3:]
        }

        # ---- snapshot v1 + PLAN CYCLE A (audios 1-2) -----------------------
        tool_results = ctx_holder["tool_results"]
        with self._stage("situation_snapshot_v1"):
            snapshot = await self.context_agent.build_snapshot(
                incident_ctx, list(self.all_radio_events), tool_results
            )
        snapshot = self._merge_seeded_roads(snapshot)
        self._register_events(snapshot, self.all_radio_events)
        self._debug_snapshot = snapshot  # failure-report hook
        machine.submit_situation_snapshot(dict(snapshot))

        self._open_window("planning_cycle_a")
        plan, escalated = await self._planning_cycle("cycle_a", snapshot)
        self._close_window("planning_cycle_a")

        # ---- audio 3: wind shift -> snapshot/state update ONLY -------------
        events_3 = self._process_extraction(self.items[2], late=True)
        upd3 = self._apply_wind_update(snapshot, events_3, "audio_03")
        self.snapshot_updates.append(upd3)
        machine.update_situation_snapshot(dict(snapshot))

        # ---- audio 4: D17 CORRECTION -> re-plan (cycle B) -------------------
        await wave2["audio_04"]
        events_4 = self._process_extraction(self.items[3], late=True)
        self.radio_agent.recent_context.extend(events_4)
        upd4 = self._apply_d17_correction(snapshot, events_4, "audio_04")
        self.snapshot_updates.append(upd4)
        machine.update_situation_snapshot(dict(snapshot))
        machine.record_approval_decision(
            ApprovalDecision.MODIFY,
            {
                "decision": "modify",
                "operator_name": "e2e-harness",
                "operator_note": (
                    "new radio intelligence: audio_03 wind shift + audio_04 D17 "
                    "correction — plan must be updated (incremental re-plan)"
                ),
                "decided_at": _utcnow_iso(),
            },
        )
        self._open_window("planning_cycle_b")
        plan, escalated = await self._planning_cycle(
            "cycle_b",
            snapshot,
            previous_context=self._replan_context(
                plan.to_dict(),
                reason=(
                    "NEW INTELLIGENCE since this plan: (1) wind shifted to the "
                    "south-east and is strengthening, fire progressing toward the "
                    "D17; (2) CORRECTION — the D17 is NOT fully blocked: impassable "
                    "for heavy trucks (CCF), light vehicles can pass via the north "
                    "side. Update the plan incrementally; keep what is still valid."
                ),
                new_events=events_3 + events_4,
            ),
        )
        self._close_window("planning_cycle_b")

        # ---- audio 5: explosions CONFIRMED -> final plan (cycle C) ----------
        await wave2["audio_05"]
        events_5 = self._process_extraction(self.items[4], late=True)
        upd5 = self._apply_hazard_confirmation(snapshot, events_5, "audio_05")
        self.snapshot_updates.append(upd5)
        machine.update_situation_snapshot(dict(snapshot))
        machine.record_approval_decision(
            ApprovalDecision.MODIFY,
            {
                "decision": "modify",
                "operator_name": "e2e-harness",
                "operator_note": (
                    "new radio intelligence: audio_05 visual confirmation — the "
                    "explosions come from behind the hangar, suspected gas "
                    "cylinders (hazmat). Final plan required with an exclusion "
                    "perimeter."
                ),
                "decided_at": _utcnow_iso(),
            },
        )
        self._open_window("planning_cycle_final")
        plan, escalated = await self._planning_cycle(
            "final",
            snapshot,
            previous_context=self._replan_context(
                plan.to_dict(),
                reason=(
                    "NEW INTELLIGENCE since this plan: CONFIRMED — the explosions "
                    "originate from behind the hangar; suspected gas cylinders "
                    "(hazardous material). An 'establish_perimeter' action "
                    "(exclusion perimeter, default radius 300 m) around the hangar "
                    "is now MANDATORY (safety rule sr-hazmat-perimeter). Update "
                    "the plan incrementally; keep what is still valid."
                ),
                new_events=events_5,
            ),
        )
        self._close_window("planning_cycle_final")

        # ---- human approval gate (programmatic for the E2E harness) --------
        decision = self._approval_decision(plan, escalated=escalated)
        machine.record_approval_decision(ApprovalDecision.APPROVE, dict(decision))

        # ---- dispatch + TTS ------------------------------------------------
        machine.start_dispatch({"plan_id": plan["plan_id"]})
        with self._stage("dispatch_generation"):
            instructions = await self.dispatch_agent.generate(
                dict(plan), decision, self.units_doc
            )
        for instruction in instructions:
            machine.record_dispatch_instruction(dict(instruction))

        machine.record_tts_started(
            {
                "engine": "piper",
                "voice_available": self.tts.available,
                "instruction_count": len(instructions),
            }
        )
        # Piper TTS in PARALLEL — one thread per unit (onnxruntime sessions
        # support concurrent run(); synthesize() never raises). The voice is
        # pre-loaded once to avoid a thundering-herd lazy load.
        tts_results: List[Dict[str, Any]] = []
        with self._stage("tts"):
            self._open_window("tts_parallel")
            if self.tts.available:
                try:
                    self.tts._load_voice()  # noqa: SLF001 — deterministic preload
                except Exception:  # pragma: no cover — synthesize() falls back
                    logger.exception("piper voice preload failed")

            def _synth(instruction: Dict[str, Any]) -> Dict[str, Any]:
                filename = (
                    f"{self.incident_id}_{instruction['dispatch_id']}_"
                    f"{instruction['unit_id']}.wav"
                )
                return self.tts.synthesize(instruction["message_text"], filename)

            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=max(1, len(instructions))) as pool:
                results = list(pool.map(_synth, instructions))
            self._close_window("tts_parallel")
            for instruction, result in zip(instructions, results):
                if result["status"] == "success":
                    instruction["tts_audio_path"] = result["wav_path"]
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

        self._tts_latencies = tts_results
        wav_count = sum(1 for r in tts_results if r["status"] == "success")
        for instruction in instructions:
            instruction["dispatch_status"] = "sent"
        machine.mark_dispatched(
            {"instruction_count": len(instructions), "wav_count": wav_count}
        )
        machine.complete_incident(
            {
                "audios_processed": [i["audio_id"] for i in self.items],
                "plan_id": plan["plan_id"],
                "plan_versions": machine.plan_version,
                "instructions": len(instructions),
                "wavs": wav_count,
            }
        )

        return self._build_scenario_report(
            snapshot=snapshot,
            batch_results=batch_results,
            ctx_holder=ctx_holder,
            decision=decision,
            instructions=instructions,
            tts_results=tts_results,
            final_plan=plan.to_dict(),
        )

    # ------------------------------------------------------------------ #
    # Report + verification of the narrative beats
    # ------------------------------------------------------------------ #

    def _concurrency_proof(self, batch_results) -> Dict[str, Any]:
        # True batch wall = last completion offset from the batch start (the
        # "stt_batch" window is closed lazily after overlapping LLM work, so
        # its duration would overstate the wall; live finding #53 run 5).
        stt_wall = (
            round(max(self.stt_completion_offsets.values()), 3)
            if self.stt_completion_offsets
            else self.windows.get("stt_batch", {}).get("duration_s")
        )
        individual = {
            r.audio_id: round(r.latency_ms / 1000.0, 3) for r in batch_results
        }
        sequential_sum = round(sum(individual.values()), 3)
        proof: Dict[str, Any] = {
            "stt_batch_wall_s": stt_wall,
            "stt_individual_latencies_s": individual,
            "stt_sequential_sum_s": sequential_sum,
            "stt_concurrency_gain_s": (
                round(sequential_sum - stt_wall, 3) if stt_wall is not None else None
            ),
            "stt_completion_offsets_s": dict(self.stt_completion_offsets),
            "stt_concurrent_proven": (
                stt_wall is not None and stt_wall < sequential_sum
            ),
        }
        ctx = self.windows.get("context_collection")
        stt = self.windows.get("stt_batch")
        radio = self.windows.get("radio_track_intake")
        if ctx and stt:
            proof["context_vs_stt_overlap_s"] = self._overlap(ctx, stt)
        if ctx and radio:
            proof["context_vs_radio_track_overlap_s"] = self._overlap(ctx, radio)

        # Concurrent radio-intelligence extraction (waves), measured.
        proof["radio_extraction_waves"] = {
            "wave_1_audios_1_3": self._wave_stats(["audio_01", "audio_02", "audio_03"]),
            "wave_2_audios_4_5": self._wave_stats(["audio_04", "audio_05"]),
        }
        w4 = self.windows.get("extract_audio_04")
        w5 = self.windows.get("extract_audio_05")
        pa = self.windows.get("planning_cycle_a")
        if pa and w4 and w5:
            wave2 = {
                "start_s": min(w4["start_s"], w5["start_s"]),
                "end_s": max(w4.get("end_s", 0.0), w5.get("end_s", 0.0)),
            }
            proof["wave2_vs_planning_cycle_a_overlap_s"] = self._overlap(wave2, pa)

        # Parallel Piper TTS, measured.
        tts_w = self.windows.get("tts_parallel")
        proof["tts_parallel"] = {
            "wall_s": tts_w.get("duration_s") if tts_w else None,
            "sequential_sum_s": round(
                sum((r.get("latency_ms") or 0) for r in self._tts_latencies) / 1000.0, 3
            ),
        }
        proof["llm_max_concurrent_observed"] = self.call_log.max_concurrent
        proof["windows"] = dict(self.windows)
        return proof

    def _wave_stats(self, audio_ids: List[str]) -> Dict[str, Any]:
        windows = [self.windows.get(f"extract_{a}") for a in audio_ids]
        windows = [w for w in windows if w and "end_s" in w]
        if not windows:
            return {}
        wall = round(max(w["end_s"] for w in windows) - min(w["start_s"] for w in windows), 3)
        sequential = round(sum(w["duration_s"] for w in windows), 3)
        return {
            "audios": audio_ids,
            "wall_s": wall,
            "sequential_sum_s": sequential,
            "concurrency_gain_s": round(sequential - wall, 3),
            "concurrent_proven": wall < sequential if len(windows) > 1 else None,
        }

    def _narrative_beats(self, snapshot: Mapping[str, Any], final_plan: Mapping[str, Any]) -> Dict[str, Any]:
        order_ok = [p["audio_id"] for p in self.processed_order] == [
            i["audio_id"] for i in self.items
        ]
        correction = next(
            (u for u in self.snapshot_updates if u.get("update") == "d17_correction"),
            {},
        )
        audio1_ids = set(self.processed_order[0]["events"]) if self.processed_order else set()
        explosion_reported = any(
            any("explos" in str(f).lower() for f in e.get("facts", []))
            for e in self.all_radio_events
            if e.get("event_id") in audio1_ids
        )
        audio5 = [
            e for e in self.all_radio_events if e.get("audio_id") == "audio_05"
        ]
        confirmed_in_snapshot = any(
            "confirmed" in str(f).lower() and "gas cylinder" in str(f).lower()
            for f in snapshot.get("known_facts", [])
        )
        perimeter_actions = [
            a for a in final_plan.get("unit_actions", [])
            if "perimeter" in str(a.get("action_type", "")).lower()
        ]
        return {
            "scenario_order_respected": order_ok,
            "processed_order": self.processed_order,
            "d17_correction": correction,
            "d17_correction_verified": bool(
                correction.get("is_correction")
                and correction.get("corrects_event_id")
                and correction.get("d17_entries_in_snapshot") == 1
            ),
            "explosions_reported_audio_01": explosion_reported,
            "audio_05_confirmation_events": [e.get("event_id") for e in audio5],
            "explosions_confirmed_in_snapshot": confirmed_in_snapshot,
            "final_plan_exclusion_perimeter_actions": perimeter_actions,
            "final_plan_has_exclusion_perimeter": bool(perimeter_actions),
            "safety_review_per_plan_version": len(self.reviews) == len(self.plans),
            "wind_update_without_replan": any(
                u.get("update") == "wind" for u in self.snapshot_updates
            ),
        }

    def _build_scenario_report(self, **kw: Any) -> Dict[str, Any]:
        self.timings_s["scenario_total"] = self._now_off()
        self._feed_metrics()
        audit_path = self.output_dir / f"{self.incident_id}_tool_audit.jsonl"
        self.audit_log.export_jsonl(audit_path)
        snapshot = kw["snapshot"]
        report: Dict[str, Any] = {
            "incident_id": self.incident_id,
            "generated_at": _utcnow_iso(),
            "mode": "full_scenario_5_audios",
            "final_state": self.machine.state.value,
            "timings_s": dict(self.timings_s),
            "concurrency_proof": self._concurrency_proof(kw["batch_results"]),
            "transcripts": self.transcripts,
            "radio_events": self.all_radio_events,
            "radio_extraction_meta": {
                audio_id: {
                    "confidence": ex.confidence,
                    "uncertainties": list(ex.uncertainties),
                    "structured_output_attempts": ex.attempts,
                }
                for audio_id, ex in self.extractions.items()
            },
            "context": {
                "tool_requests": [dict(r) for r in kw["ctx_holder"]["requests"]],
                "tool_results": [
                    self._tool_result_event_payload(r)
                    for r in kw["ctx_holder"]["tool_results"]
                ],
            },
            "snapshot_final": snapshot,
            "snapshot_updates": self.snapshot_updates,
            "plans": self.plans,
            "safety_reviews": self.reviews,
            "planning_cycles": self.cycles,
            "approval_decision": kw["decision"],
            "dispatch_instructions": [dict(i) for i in kw["instructions"]],
            "tts": kw["tts_results"],
            "narrative_beats": self._narrative_beats(snapshot, kw["final_plan"]),
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
