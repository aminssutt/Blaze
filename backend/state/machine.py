"""Deterministic incident state machine for BLAZE.

15 exact states (docs/ARCHITECTURE.md section 3):

    IDLE, INGESTING_AUDIO, TRANSCRIBING, EXTRACTING_RADIO_EVENTS,
    COLLECTING_CONTEXT, BUILDING_SITUATION, DRAFTING_PLAN, SAFETY_REVIEW,
    AWAITING_HUMAN_APPROVAL, REVISING_PLAN, APPROVED, GENERATING_DISPATCH,
    DISPATCHED, COMPLETED, FAILED_WITH_FALLBACK

Concurrency model
-----------------
Transcription and context collection may run in parallel. Instead of a
single opaque "parallel" state, the machine keeps:

* one global ``state`` (always one of the 15 states above), and
* two separately tracked activity statuses: ``transcription_status`` and
  ``context_status`` (PENDING / RUNNING / COMPLETE).

Deterministic precedence rule for the global state during the intake phase:

* while the transcription track is active it owns the global state
  (TRANSCRIBING, then EXTRACTING_RADIO_EVENTS);
* COLLECTING_CONTEXT is the global state only when context collection is
  the sole remaining active work;
* BUILDING_SITUATION is reachable only when BOTH tracks are COMPLETE with
  the minimum required data (planning gate).

Safety properties by construction
---------------------------------
* Safety review is mandatory: the only transition into
  AWAITING_HUMAN_APPROVAL is a *pass* safety review, and every submitted
  plan (draft or revised) lands in SAFETY_REVIEW.
* Dispatch before approval is impossible: the only transition into
  GENERATING_DISPATCH starts from APPROVED. No other method exists.
* Every transition emits >= 1 contract-valid EventEnvelope (injectable
  observers) and appends a timestamped AuditRecord.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, FrozenSet, Iterable, List, Optional, Tuple
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from .events import EventEnvelope, EventListener, EventType


class IncidentState(str, Enum):
    """The 15 exact incident states."""

    IDLE = "IDLE"
    INGESTING_AUDIO = "INGESTING_AUDIO"
    TRANSCRIBING = "TRANSCRIBING"
    EXTRACTING_RADIO_EVENTS = "EXTRACTING_RADIO_EVENTS"
    COLLECTING_CONTEXT = "COLLECTING_CONTEXT"
    BUILDING_SITUATION = "BUILDING_SITUATION"
    DRAFTING_PLAN = "DRAFTING_PLAN"
    SAFETY_REVIEW = "SAFETY_REVIEW"
    AWAITING_HUMAN_APPROVAL = "AWAITING_HUMAN_APPROVAL"
    REVISING_PLAN = "REVISING_PLAN"
    APPROVED = "APPROVED"
    GENERATING_DISPATCH = "GENERATING_DISPATCH"
    DISPATCHED = "DISPATCHED"
    COMPLETED = "COMPLETED"
    FAILED_WITH_FALLBACK = "FAILED_WITH_FALLBACK"


TERMINAL_STATES: FrozenSet[IncidentState] = frozenset(
    {IncidentState.COMPLETED, IncidentState.FAILED_WITH_FALLBACK}
)


class ActivityStatus(str, Enum):
    """Status of one concurrent activity track."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETE = "COMPLETE"


class SafetyReviewStatus(str, Enum):
    """Mirrors safety_review.schema.json status enum."""

    PASS = "pass"
    REVISE = "revise"
    BLOCK = "block"


class ApprovalDecision(str, Enum):
    """Mirrors approval_decision.schema.json decision enum."""

    APPROVE = "approve"
    MODIFY = "modify"
    REJECT = "reject"


class IllegalTransitionError(RuntimeError):
    """Raised when a trigger is fired from a state where it does not exist."""

    def __init__(self, trigger: str, state: IncidentState, reason: str = "") -> None:
        self.trigger = trigger
        self.state = state
        message = f"Illegal transition: trigger '{trigger}' is not defined in state {state.value}"
        if reason:
            message += f" ({reason})"
        super().__init__(message)


class AuditRecord(BaseModel):
    """One timestamped, immutable entry of the audit trail."""

    model_config = ConfigDict(frozen=True)

    index: int = Field(ge=1)
    timestamp: str
    trigger: str
    from_state: IncidentState
    to_state: IncidentState
    transcription_status: ActivityStatus
    context_status: ActivityStatus
    plan_version: int
    emitted_event_types: Tuple[EventType, ...]
    emitted_event_ids: Tuple[str, ...]
    details: Dict[str, Any] = Field(default_factory=dict)


class IncidentStateMachine:
    """Deterministic, auditable incident state machine (no I/O, no LLM)."""

    def __init__(
        self,
        incident_id: Optional[str] = None,
        *,
        min_radio_events: int = 1,
        min_context_results: int = 1,
        clock: Optional[Callable[[], datetime]] = None,
    ) -> None:
        self._incident_id = incident_id or f"incident-{uuid4().hex[:12]}"
        self._state = IncidentState.IDLE
        self._transcription = ActivityStatus.PENDING
        self._context = ActivityStatus.PENDING
        self._min_radio_events = min_radio_events
        self._min_context_results = min_context_results
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._listeners: List[EventListener] = []
        self._audit: List[AuditRecord] = []
        self._events: List[EventEnvelope] = []
        self._sequence = 0
        self._radio_event_count = 0
        self._tool_result_count = 0
        self._plan_versions: List[Dict[str, Any]] = []
        self._approval_decisions: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------ #
    # Introspection
    # ------------------------------------------------------------------ #

    @property
    def incident_id(self) -> str:
        return self._incident_id

    @property
    def state(self) -> IncidentState:
        return self._state

    @property
    def transcription_status(self) -> ActivityStatus:
        return self._transcription

    @property
    def context_status(self) -> ActivityStatus:
        return self._context

    @property
    def radio_event_count(self) -> int:
        return self._radio_event_count

    @property
    def tool_result_count(self) -> int:
        return self._tool_result_count

    @property
    def plan_version(self) -> int:
        """Current plan version (0 before any draft)."""
        return len(self._plan_versions)

    @property
    def plan_versions(self) -> Tuple[Dict[str, Any], ...]:
        return tuple(self._plan_versions)

    @property
    def approval_decisions(self) -> Tuple[Dict[str, Any], ...]:
        return tuple(self._approval_decisions)

    @property
    def audit_trail(self) -> Tuple[AuditRecord, ...]:
        return tuple(self._audit)

    @property
    def emitted_events(self) -> Tuple[EventEnvelope, ...]:
        return tuple(self._events)

    @property
    def is_terminal(self) -> bool:
        return self._state in TERMINAL_STATES

    def add_listener(self, listener: EventListener) -> None:
        """Register an injectable observer called for every emitted envelope."""
        self._listeners.append(listener)

    def remove_listener(self, listener: EventListener) -> None:
        self._listeners.remove(listener)

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _guard(
        self,
        trigger: str,
        allowed: Iterable[IncidentState],
        reason: str = "",
    ) -> None:
        allowed_set = frozenset(allowed)
        if self._state not in allowed_set:
            extra = reason
            if self._state in TERMINAL_STATES and not reason:
                extra = "incident is in a terminal state"
            raise IllegalTransitionError(trigger, self._state, extra)

    def _commit(
        self,
        trigger: str,
        new_state: IncidentState,
        events: List[Tuple[EventType, Dict[str, Any]]],
        details: Optional[Dict[str, Any]] = None,
    ) -> List[EventEnvelope]:
        """Apply the transition: update state, emit envelopes, append audit."""
        if not events:  # pragma: no cover - internal invariant
            raise ValueError("every transition must emit at least one event")
        from_state = self._state
        self._state = new_state
        now = self._clock().isoformat()

        envelopes: List[EventEnvelope] = []
        for event_type, payload in events:
            self._sequence += 1
            envelope = EventEnvelope(
                event_id=f"evt-{uuid4().hex[:12]}",
                incident_id=self._incident_id,
                event_type=event_type,
                timestamp=now,
                sequence=self._sequence,
                payload=payload,
            )
            envelopes.append(envelope)
            self._events.append(envelope)

        self._audit.append(
            AuditRecord(
                index=len(self._audit) + 1,
                timestamp=now,
                trigger=trigger,
                from_state=from_state,
                to_state=new_state,
                transcription_status=self._transcription,
                context_status=self._context,
                plan_version=self.plan_version,
                emitted_event_types=tuple(e.event_type for e in envelopes),
                emitted_event_ids=tuple(e.event_id for e in envelopes),
                details=dict(details or {}),
            )
        )

        for listener in list(self._listeners):
            for envelope in envelopes:
                listener(envelope)
        return envelopes

    @staticmethod
    def _payload(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return dict(payload or {})

    # ------------------------------------------------------------------ #
    # Intake phase
    # ------------------------------------------------------------------ #

    def start_incident(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """IDLE -> INGESTING_AUDIO."""
        self._guard("start_incident", {IncidentState.IDLE})
        return self._commit(
            "start_incident",
            IncidentState.INGESTING_AUDIO,
            [(EventType.INCIDENT_STARTED, self._payload(payload))],
        )

    def receive_audio(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """Audio chunk received (self-transition during the intake phase)."""
        allowed = {
            IncidentState.INGESTING_AUDIO,
            IncidentState.TRANSCRIBING,
            IncidentState.COLLECTING_CONTEXT,
            IncidentState.EXTRACTING_RADIO_EVENTS,
        }
        self._guard("receive_audio", allowed)
        return self._commit(
            "receive_audio",
            self._state,
            [(EventType.AUDIO_RECEIVED, self._payload(payload))],
        )

    def start_transcription(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """Start the transcription track. Global state -> TRANSCRIBING.

        Legal from INGESTING_AUDIO, or from COLLECTING_CONTEXT when the
        context track started first (parallel activities).
        """
        self._guard(
            "start_transcription",
            {IncidentState.INGESTING_AUDIO, IncidentState.COLLECTING_CONTEXT},
        )
        if self._transcription is not ActivityStatus.PENDING:
            raise IllegalTransitionError(
                "start_transcription", self._state, "transcription track already started"
            )
        self._transcription = ActivityStatus.RUNNING
        return self._commit(
            "start_transcription",
            IncidentState.TRANSCRIBING,
            [(EventType.TRANSCRIPTION_STARTED, self._payload(payload))],
        )

    def start_context_collection(
        self, payload: Optional[Dict[str, Any]] = None
    ) -> List[EventEnvelope]:
        """Start the context-collection track, possibly in PARALLEL with
        transcription.

        The global state becomes COLLECTING_CONTEXT only when the
        transcription track is not the currently active owner of the global
        state; otherwise the global state is unchanged and the parallel
        activity is tracked through ``context_status``.
        """
        self._guard(
            "start_context_collection",
            {
                IncidentState.INGESTING_AUDIO,
                IncidentState.TRANSCRIBING,
                IncidentState.EXTRACTING_RADIO_EVENTS,
                IncidentState.COLLECTING_CONTEXT,
            },
        )
        if self._context is not ActivityStatus.PENDING:
            raise IllegalTransitionError(
                "start_context_collection", self._state, "context track already started"
            )
        self._context = ActivityStatus.RUNNING
        if self._state in {IncidentState.INGESTING_AUDIO, IncidentState.COLLECTING_CONTEXT}:
            new_state = IncidentState.COLLECTING_CONTEXT
        else:
            new_state = self._state  # transcription track owns the global state
        return self._commit(
            "start_context_collection",
            new_state,
            [(EventType.CONTEXT_AGENT_STARTED, self._payload(payload))],
        )

    # -- transcription track ------------------------------------------- #

    def transcript_ready(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """TRANSCRIBING -> EXTRACTING_RADIO_EVENTS."""
        self._guard("transcript_ready", {IncidentState.TRANSCRIBING})
        return self._commit(
            "transcript_ready",
            IncidentState.EXTRACTING_RADIO_EVENTS,
            [
                (EventType.TRANSCRIPT_READY, self._payload(payload)),
                (EventType.RADIO_AGENT_STARTED, {}),
            ],
        )

    def record_radio_event(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """One structured RadioEvent extracted (self-transition)."""
        self._guard("record_radio_event", {IncidentState.EXTRACTING_RADIO_EVENTS})
        self._radio_event_count += 1
        return self._commit(
            "record_radio_event",
            self._state,
            [(EventType.RADIO_EVENT_EXTRACTED, self._payload(payload))],
            details={"radio_event_count": self._radio_event_count},
        )

    def complete_radio_extraction(
        self, payload: Optional[Dict[str, Any]] = None
    ) -> List[EventEnvelope]:
        """Finish the transcription/radio track.

        Planning gate: requires the configured minimum of radio events.
        Global state: BUILDING_SITUATION if context is already complete,
        otherwise COLLECTING_CONTEXT (context is the sole remaining work).
        """
        self._guard("complete_radio_extraction", {IncidentState.EXTRACTING_RADIO_EVENTS})
        if self._radio_event_count < self._min_radio_events:
            raise IllegalTransitionError(
                "complete_radio_extraction",
                self._state,
                f"minimum radio data not reached "
                f"({self._radio_event_count}/{self._min_radio_events} radio events)",
            )
        self._transcription = ActivityStatus.COMPLETE
        if self._context is ActivityStatus.COMPLETE:
            new_state = IncidentState.BUILDING_SITUATION
        else:
            new_state = IncidentState.COLLECTING_CONTEXT
        base = self._payload(payload)
        base.update(
            {
                "metric": "radio_events_extracted",
                "value": self._radio_event_count,
                "track": "transcription",
                "track_status": ActivityStatus.COMPLETE.value,
            }
        )
        return self._commit(
            "complete_radio_extraction",
            new_state,
            [(EventType.METRIC_UPDATED, base)],
        )

    # -- context track -------------------------------------------------- #

    def record_tool_call(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """Context agent requested a tool call (parallel-safe self-transition)."""
        self._guard(
            "record_tool_call",
            {
                IncidentState.COLLECTING_CONTEXT,
                IncidentState.TRANSCRIBING,
                IncidentState.EXTRACTING_RADIO_EVENTS,
            },
        )
        if self._context is not ActivityStatus.RUNNING:
            raise IllegalTransitionError(
                "record_tool_call", self._state, "context track is not running"
            )
        return self._commit(
            "record_tool_call",
            self._state,
            [(EventType.TOOL_CALL_REQUESTED, self._payload(payload))],
        )

    def record_tool_result(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """A tool call completed (parallel-safe self-transition)."""
        self._guard(
            "record_tool_result",
            {
                IncidentState.COLLECTING_CONTEXT,
                IncidentState.TRANSCRIBING,
                IncidentState.EXTRACTING_RADIO_EVENTS,
            },
        )
        if self._context is not ActivityStatus.RUNNING:
            raise IllegalTransitionError(
                "record_tool_result", self._state, "context track is not running"
            )
        self._tool_result_count += 1
        return self._commit(
            "record_tool_result",
            self._state,
            [(EventType.TOOL_CALL_COMPLETED, self._payload(payload))],
            details={"tool_result_count": self._tool_result_count},
        )

    def complete_context_collection(
        self, payload: Optional[Dict[str, Any]] = None
    ) -> List[EventEnvelope]:
        """Finish the context-collection track.

        Planning gate: requires the configured minimum of tool results.
        Global state: BUILDING_SITUATION if the transcription track is
        already complete, otherwise unchanged (transcription still owns it).
        """
        self._guard(
            "complete_context_collection",
            {
                IncidentState.COLLECTING_CONTEXT,
                IncidentState.TRANSCRIBING,
                IncidentState.EXTRACTING_RADIO_EVENTS,
            },
        )
        if self._context is not ActivityStatus.RUNNING:
            raise IllegalTransitionError(
                "complete_context_collection", self._state, "context track is not running"
            )
        if self._tool_result_count < self._min_context_results:
            raise IllegalTransitionError(
                "complete_context_collection",
                self._state,
                f"minimum context data not reached "
                f"({self._tool_result_count}/{self._min_context_results} tool results)",
            )
        self._context = ActivityStatus.COMPLETE
        if self._transcription is ActivityStatus.COMPLETE:
            new_state = IncidentState.BUILDING_SITUATION
        else:
            new_state = self._state
        base = self._payload(payload)
        base.update(
            {
                "metric": "context_tool_results",
                "value": self._tool_result_count,
                "track": "context_collection",
                "track_status": ActivityStatus.COMPLETE.value,
            }
        )
        return self._commit(
            "complete_context_collection",
            new_state,
            [(EventType.METRIC_UPDATED, base)],
        )

    # ------------------------------------------------------------------ #
    # Situation and planning
    # ------------------------------------------------------------------ #

    def submit_situation_snapshot(
        self, payload: Optional[Dict[str, Any]] = None
    ) -> List[EventEnvelope]:
        """BUILDING_SITUATION -> DRAFTING_PLAN (snapshot ready, planning starts)."""
        self._guard("submit_situation_snapshot", {IncidentState.BUILDING_SITUATION})
        return self._commit(
            "submit_situation_snapshot",
            IncidentState.DRAFTING_PLAN,
            [
                (EventType.SITUATION_SNAPSHOT_READY, self._payload(payload)),
                (EventType.PLANNING_STARTED, {}),
            ],
        )

    def submit_draft_plan(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """DRAFTING_PLAN | REVISING_PLAN -> SAFETY_REVIEW.

        Creates a NEW plan version each time (audit trail preserved). Every
        plan version, initial or revised, must pass through SAFETY_REVIEW:
        this is the only outgoing transition, so safety review is mandatory
        by construction.
        """
        self._guard(
            "submit_draft_plan",
            {IncidentState.DRAFTING_PLAN, IncidentState.REVISING_PLAN},
        )
        plan = self._payload(payload)
        version = len(self._plan_versions) + 1
        plan.setdefault("plan_version", version)
        self._plan_versions.append(plan)
        return self._commit(
            "submit_draft_plan",
            IncidentState.SAFETY_REVIEW,
            [
                (EventType.PLAN_DRAFT_READY, dict(plan)),
                (EventType.SAFETY_REVIEW_STARTED, {"plan_version": version}),
            ],
            details={"plan_version": version},
        )

    def complete_safety_review(
        self,
        status: SafetyReviewStatus,
        payload: Optional[Dict[str, Any]] = None,
    ) -> List[EventEnvelope]:
        """SAFETY_REVIEW -> AWAITING_HUMAN_APPROVAL (pass) | REVISING_PLAN
        (revise / block)."""
        self._guard("complete_safety_review", {IncidentState.SAFETY_REVIEW})
        status = SafetyReviewStatus(status)
        review = self._payload(payload)
        review.setdefault("status", status.value)
        review.setdefault("plan_version", self.plan_version)
        if status is SafetyReviewStatus.PASS:
            return self._commit(
                "complete_safety_review",
                IncidentState.AWAITING_HUMAN_APPROVAL,
                [
                    (EventType.SAFETY_REVIEW_READY, review),
                    (EventType.APPROVAL_REQUESTED, {"plan_version": self.plan_version}),
                ],
                details={"safety_status": status.value},
            )
        return self._commit(
            "complete_safety_review",
            IncidentState.REVISING_PLAN,
            [
                (EventType.SAFETY_REVIEW_READY, review),
                (EventType.PLAN_REVISION_REQUESTED, {"reason": f"safety_{status.value}"}),
            ],
            details={"safety_status": status.value},
        )

    # ------------------------------------------------------------------ #
    # Human decision
    # ------------------------------------------------------------------ #

    def record_approval_decision(
        self,
        decision: ApprovalDecision,
        payload: Optional[Dict[str, Any]] = None,
        *,
        end_incident: bool = False,
    ) -> List[EventEnvelope]:
        """AWAITING_HUMAN_APPROVAL ->
        APPROVED (approve) | REVISING_PLAN (modify, reject) |
        COMPLETED (reject with end_incident=True).

        ``modify`` requests a new plan version incorporating the operator's
        modifications; the revised plan goes back through SAFETY_REVIEW.
        ``reject`` returns to planning, or ends the scenario when
        ``end_incident`` is True.
        """
        self._guard("record_approval_decision", {IncidentState.AWAITING_HUMAN_APPROVAL})
        decision = ApprovalDecision(decision)
        record = self._payload(payload)
        record.setdefault("decision", decision.value)
        record.setdefault("plan_version", self.plan_version)
        self._approval_decisions.append(dict(record))

        if decision is ApprovalDecision.APPROVE:
            return self._commit(
                "record_approval_decision",
                IncidentState.APPROVED,
                [(EventType.APPROVAL_RECEIVED, record)],
                details={"decision": decision.value},
            )
        if decision is ApprovalDecision.MODIFY:
            return self._commit(
                "record_approval_decision",
                IncidentState.REVISING_PLAN,
                [
                    (EventType.APPROVAL_RECEIVED, record),
                    (EventType.PLAN_REVISION_REQUESTED, {"reason": "operator_modify"}),
                ],
                details={"decision": decision.value},
            )
        # reject
        if end_incident:
            return self._commit(
                "record_approval_decision",
                IncidentState.COMPLETED,
                [
                    (EventType.APPROVAL_RECEIVED, record),
                    (EventType.INCIDENT_COMPLETED, {"reason": "rejected_and_closed"}),
                ],
                details={"decision": decision.value, "end_incident": True},
            )
        return self._commit(
            "record_approval_decision",
            IncidentState.REVISING_PLAN,
            [
                (EventType.APPROVAL_RECEIVED, record),
                (EventType.PLAN_REVISION_REQUESTED, {"reason": "operator_reject"}),
            ],
            details={"decision": decision.value, "end_incident": False},
        )

    # ------------------------------------------------------------------ #
    # Dispatch (only reachable from APPROVED, by construction)
    # ------------------------------------------------------------------ #

    def start_dispatch(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """APPROVED -> GENERATING_DISPATCH. The ONLY transition into dispatch."""
        self._guard(
            "start_dispatch",
            {IncidentState.APPROVED},
            "dispatch is impossible before human approval",
        )
        return self._commit(
            "start_dispatch",
            IncidentState.GENERATING_DISPATCH,
            [(EventType.DISPATCH_STARTED, self._payload(payload))],
        )

    def record_dispatch_instruction(
        self, payload: Optional[Dict[str, Any]] = None
    ) -> List[EventEnvelope]:
        """One per-unit dispatch instruction generated (self-transition)."""
        self._guard("record_dispatch_instruction", {IncidentState.GENERATING_DISPATCH})
        return self._commit(
            "record_dispatch_instruction",
            self._state,
            [(EventType.DISPATCH_INSTRUCTION_READY, self._payload(payload))],
        )

    def record_tts_started(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        self._guard("record_tts_started", {IncidentState.GENERATING_DISPATCH})
        return self._commit(
            "record_tts_started",
            self._state,
            [(EventType.TTS_STARTED, self._payload(payload))],
        )

    def record_tts_ready(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        self._guard("record_tts_ready", {IncidentState.GENERATING_DISPATCH})
        return self._commit(
            "record_tts_ready",
            self._state,
            [(EventType.TTS_READY, self._payload(payload))],
        )

    def mark_dispatched(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """GENERATING_DISPATCH -> DISPATCHED."""
        self._guard("mark_dispatched", {IncidentState.GENERATING_DISPATCH})
        return self._commit(
            "mark_dispatched",
            IncidentState.DISPATCHED,
            [(EventType.DISPATCH_SENT, self._payload(payload))],
        )

    def complete_incident(self, payload: Optional[Dict[str, Any]] = None) -> List[EventEnvelope]:
        """DISPATCHED -> COMPLETED (terminal)."""
        self._guard("complete_incident", {IncidentState.DISPATCHED})
        return self._commit(
            "complete_incident",
            IncidentState.COMPLETED,
            [(EventType.INCIDENT_COMPLETED, self._payload(payload))],
        )

    # ------------------------------------------------------------------ #
    # Failure path
    # ------------------------------------------------------------------ #

    def fail_with_fallback(
        self, reason: str, payload: Optional[Dict[str, Any]] = None
    ) -> List[EventEnvelope]:
        """Any non-terminal state -> FAILED_WITH_FALLBACK (terminal)."""
        self._guard(
            "fail_with_fallback",
            frozenset(IncidentState) - TERMINAL_STATES,
        )
        base = self._payload(payload)
        base.setdefault("reason", reason)
        return self._commit(
            "fail_with_fallback",
            IncidentState.FAILED_WITH_FALLBACK,
            [
                (EventType.ERROR, {"reason": reason}),
                (EventType.FALLBACK_ACTIVATED, base),
            ],
            details={"reason": reason},
        )
