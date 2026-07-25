"""Exhaustive tests for the deterministic BLAZE incident state machine."""

import json
from datetime import datetime
from pathlib import Path

import pytest

from backend.state import (
    TERMINAL_STATES,
    ActivityStatus,
    ApprovalDecision,
    EventEnvelope,
    EventType,
    IllegalTransitionError,
    IncidentState,
    IncidentStateMachine,
    SafetyReviewStatus,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "contracts" / "schemas" / "event_envelope.schema.json"
)


# --------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------- #


def machine_at_awaiting_approval(**kwargs) -> IncidentStateMachine:
    """Drive a machine to AWAITING_HUMAN_APPROVAL through the full pipeline."""
    m = IncidentStateMachine("incident-test", **kwargs)
    m.start_incident({"scenario": "demo"})
    m.receive_audio({"chunk": 1})
    m.start_transcription()
    m.start_context_collection()  # parallel with transcription
    m.record_tool_call({"tool": "open_meteo"})
    m.record_tool_result({"tool": "open_meteo", "ok": True})
    m.transcript_ready({"text": "feu de foret secteur nord"})
    m.record_radio_event({"kind": "sighting"})
    m.complete_context_collection()
    m.complete_radio_extraction()
    assert m.state is IncidentState.BUILDING_SITUATION
    m.submit_situation_snapshot({"snapshot_id": "snap-1"})
    m.submit_draft_plan({"plan_id": "plan-1"})
    m.complete_safety_review(SafetyReviewStatus.PASS)
    assert m.state is IncidentState.AWAITING_HUMAN_APPROVAL
    return m


def drive_to_completed(m: IncidentStateMachine) -> None:
    m.record_approval_decision(ApprovalDecision.APPROVE, {"operator_name": "cmdr"})
    m.start_dispatch()
    m.record_dispatch_instruction({"unit_id": "VSAV-1"})
    m.record_tts_started()
    m.record_tts_ready()
    m.mark_dispatched()
    m.complete_incident()


# --------------------------------------------------------------------- #
# States and happy path
# --------------------------------------------------------------------- #


def test_exactly_15_states():
    expected = {
        "IDLE",
        "INGESTING_AUDIO",
        "TRANSCRIBING",
        "EXTRACTING_RADIO_EVENTS",
        "COLLECTING_CONTEXT",
        "BUILDING_SITUATION",
        "DRAFTING_PLAN",
        "SAFETY_REVIEW",
        "AWAITING_HUMAN_APPROVAL",
        "REVISING_PLAN",
        "APPROVED",
        "GENERATING_DISPATCH",
        "DISPATCHED",
        "COMPLETED",
        "FAILED_WITH_FALLBACK",
    }
    assert {s.value for s in IncidentState} == expected
    assert len(IncidentState) == 15


def test_happy_path_reaches_completed():
    m = machine_at_awaiting_approval()
    drive_to_completed(m)
    assert m.state is IncidentState.COMPLETED
    assert m.is_terminal


def test_initial_state_is_idle():
    m = IncidentStateMachine()
    assert m.state is IncidentState.IDLE
    assert m.transcription_status is ActivityStatus.PENDING
    assert m.context_status is ActivityStatus.PENDING
    assert m.audit_trail == ()
    assert m.emitted_events == ()


# --------------------------------------------------------------------- #
# Parallelism: transcription and context collection
# --------------------------------------------------------------------- #


def test_context_runs_in_parallel_with_transcription():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_transcription()
    assert m.state is IncidentState.TRANSCRIBING
    m.start_context_collection()
    # Transcription track owns the global state; context tracked separately.
    assert m.state is IncidentState.TRANSCRIBING
    assert m.context_status is ActivityStatus.RUNNING
    # Context tool activity is legal while transcribing.
    m.record_tool_call({"tool": "firms"})
    m.record_tool_result({"tool": "firms"})
    assert m.state is IncidentState.TRANSCRIBING


def test_context_can_start_before_transcription():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_context_collection()
    assert m.state is IncidentState.COLLECTING_CONTEXT
    m.start_transcription()
    assert m.state is IncidentState.TRANSCRIBING
    assert m.context_status is ActivityStatus.RUNNING
    assert m.transcription_status is ActivityStatus.RUNNING


def test_radio_done_first_then_context_completes_into_building_situation():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_transcription()
    m.start_context_collection()
    m.transcript_ready()
    m.record_radio_event()
    m.complete_radio_extraction()
    # Context is the sole remaining active work.
    assert m.state is IncidentState.COLLECTING_CONTEXT
    assert m.transcription_status is ActivityStatus.COMPLETE
    m.record_tool_result()
    m.complete_context_collection()
    assert m.state is IncidentState.BUILDING_SITUATION


def test_context_done_first_then_radio_completes_into_building_situation():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_transcription()
    m.start_context_collection()
    m.record_tool_result()
    m.complete_context_collection()
    # Transcription still owns the global state.
    assert m.state is IncidentState.TRANSCRIBING
    assert m.context_status is ActivityStatus.COMPLETE
    m.transcript_ready()
    m.record_radio_event()
    m.complete_radio_extraction()
    assert m.state is IncidentState.BUILDING_SITUATION


def test_activity_tracks_cannot_start_twice():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_transcription()
    with pytest.raises(IllegalTransitionError):
        m.start_transcription()
    m.start_context_collection()
    with pytest.raises(IllegalTransitionError):
        m.start_context_collection()


# --------------------------------------------------------------------- #
# Planning gate: minimum radio + context data
# --------------------------------------------------------------------- #


def test_radio_extraction_cannot_complete_without_min_radio_events():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_transcription()
    m.transcript_ready()
    with pytest.raises(IllegalTransitionError, match="minimum radio data"):
        m.complete_radio_extraction()


def test_context_cannot_complete_without_min_tool_results():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_context_collection()
    with pytest.raises(IllegalTransitionError, match="minimum context data"):
        m.complete_context_collection()


def test_planning_unreachable_without_both_tracks_complete():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_transcription()
    m.start_context_collection()
    m.record_tool_result()
    m.complete_context_collection()
    # Radio track not complete: BUILDING_SITUATION not reached, so the
    # planning pipeline cannot be entered.
    assert m.state is not IncidentState.BUILDING_SITUATION
    with pytest.raises(IllegalTransitionError):
        m.submit_situation_snapshot()
    with pytest.raises(IllegalTransitionError):
        m.submit_draft_plan()


# --------------------------------------------------------------------- #
# Safety review is mandatory before approval
# --------------------------------------------------------------------- #


def test_plan_always_lands_in_safety_review():
    m = machine_at_awaiting_approval()
    # The only path here went DRAFTING_PLAN -> SAFETY_REVIEW.
    states_visited = [r.to_state for r in m.audit_trail]
    idx_review = states_visited.index(IncidentState.SAFETY_REVIEW)
    idx_approval = states_visited.index(IncidentState.AWAITING_HUMAN_APPROVAL)
    assert idx_review < idx_approval


def test_approval_impossible_without_safety_review():
    m = IncidentStateMachine()
    m.start_incident()
    with pytest.raises(IllegalTransitionError):
        m.record_approval_decision(ApprovalDecision.APPROVE)
    # Even from DRAFTING_PLAN there is no shortcut to approval.
    m2 = machine_at_awaiting_approval()
    m2.record_approval_decision(ApprovalDecision.MODIFY)  # -> REVISING_PLAN
    with pytest.raises(IllegalTransitionError):
        m2.record_approval_decision(ApprovalDecision.APPROVE)


def test_safety_review_revise_routes_to_revising_plan():
    m = IncidentStateMachine("i")
    m.start_incident()
    m.start_transcription()
    m.start_context_collection()
    m.record_tool_result()
    m.complete_context_collection()
    m.transcript_ready()
    m.record_radio_event()
    m.complete_radio_extraction()
    m.submit_situation_snapshot()
    m.submit_draft_plan()
    m.complete_safety_review(SafetyReviewStatus.REVISE)
    assert m.state is IncidentState.REVISING_PLAN
    # Revised plan must go through safety review again.
    m.submit_draft_plan()
    assert m.state is IncidentState.SAFETY_REVIEW
    assert m.plan_version == 2


def test_safety_review_block_routes_to_revising_plan():
    m = machine_at_awaiting_approval()
    m.record_approval_decision(ApprovalDecision.MODIFY)
    m.submit_draft_plan()
    m.complete_safety_review(SafetyReviewStatus.BLOCK)
    assert m.state is IncidentState.REVISING_PLAN


# --------------------------------------------------------------------- #
# Approve / modify / reject branches
# --------------------------------------------------------------------- #


def test_approve_branch():
    m = machine_at_awaiting_approval()
    events = m.record_approval_decision(
        ApprovalDecision.APPROVE, {"operator_name": "cmdr", "decision_id": "d1"}
    )
    assert m.state is IncidentState.APPROVED
    assert [e.event_type for e in events] == [EventType.APPROVAL_RECEIVED]
    assert m.approval_decisions[-1]["decision"] == "approve"


def test_modify_branch_creates_new_plan_version_and_rereviews():
    m = machine_at_awaiting_approval()
    assert m.plan_version == 1
    events = m.record_approval_decision(
        ApprovalDecision.MODIFY, {"operator_name": "cmdr", "modified_actions": []}
    )
    assert m.state is IncidentState.REVISING_PLAN
    assert EventType.PLAN_REVISION_REQUESTED in [e.event_type for e in events]
    # New plan version, previous version preserved in the audit trail.
    m.submit_draft_plan({"plan_id": "plan-2"})
    assert m.plan_version == 2
    assert len(m.plan_versions) == 2
    assert m.plan_versions[0]["plan_version"] == 1
    assert m.state is IncidentState.SAFETY_REVIEW
    # And safety review + approval are required again before dispatch.
    m.complete_safety_review(SafetyReviewStatus.PASS)
    m.record_approval_decision(ApprovalDecision.APPROVE)
    m.start_dispatch()
    assert m.state is IncidentState.GENERATING_DISPATCH


def test_reject_branch_replan():
    m = machine_at_awaiting_approval()
    events = m.record_approval_decision(ApprovalDecision.REJECT, {"operator_name": "cmdr"})
    assert m.state is IncidentState.REVISING_PLAN
    assert EventType.PLAN_REVISION_REQUESTED in [e.event_type for e in events]


def test_reject_branch_ends_incident():
    m = machine_at_awaiting_approval()
    events = m.record_approval_decision(
        ApprovalDecision.REJECT, {"operator_name": "cmdr"}, end_incident=True
    )
    assert m.state is IncidentState.COMPLETED
    assert m.is_terminal
    assert EventType.INCIDENT_COMPLETED in [e.event_type for e in events]


# --------------------------------------------------------------------- #
# Dispatch impossible before approval (by construction)
# --------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "setup",
    [
        lambda m: None,  # IDLE
        lambda m: m.start_incident(),  # INGESTING_AUDIO
        lambda m: (m.start_incident(), m.start_transcription()),  # TRANSCRIBING
        lambda m: (m.start_incident(), m.start_context_collection()),  # COLLECTING_CONTEXT
    ],
)
def test_dispatch_impossible_in_early_states(setup):
    m = IncidentStateMachine()
    setup(m)
    with pytest.raises(IllegalTransitionError, match="dispatch is impossible before"):
        m.start_dispatch()


def test_dispatch_impossible_during_safety_review_and_awaiting_approval():
    m = machine_at_awaiting_approval()
    with pytest.raises(IllegalTransitionError):
        m.start_dispatch()  # AWAITING_HUMAN_APPROVAL is NOT approval
    m.record_approval_decision(ApprovalDecision.MODIFY)
    m.submit_draft_plan()
    assert m.state is IncidentState.SAFETY_REVIEW
    with pytest.raises(IllegalTransitionError):
        m.start_dispatch()


def test_dispatch_instruction_impossible_outside_generating_dispatch():
    m = machine_at_awaiting_approval()
    with pytest.raises(IllegalTransitionError):
        m.record_dispatch_instruction()
    with pytest.raises(IllegalTransitionError):
        m.mark_dispatched()


def test_dispatch_possible_only_after_approve():
    m = machine_at_awaiting_approval()
    m.record_approval_decision(ApprovalDecision.APPROVE)
    m.start_dispatch()
    assert m.state is IncidentState.GENERATING_DISPATCH


# --------------------------------------------------------------------- #
# Other illegal transitions
# --------------------------------------------------------------------- #


def test_illegal_transitions_from_idle():
    m = IncidentStateMachine()
    for call in [
        m.receive_audio,
        m.start_transcription,
        m.start_context_collection,
        m.transcript_ready,
        m.record_radio_event,
        m.complete_radio_extraction,
        m.record_tool_call,
        m.record_tool_result,
        m.complete_context_collection,
        m.submit_situation_snapshot,
        m.submit_draft_plan,
        m.start_dispatch,
        m.mark_dispatched,
        m.complete_incident,
    ]:
        with pytest.raises(IllegalTransitionError):
            call()
    with pytest.raises(IllegalTransitionError):
        m.complete_safety_review(SafetyReviewStatus.PASS)
    with pytest.raises(IllegalTransitionError):
        m.record_approval_decision(ApprovalDecision.APPROVE)
    assert m.state is IncidentState.IDLE
    assert m.audit_trail == ()  # failed triggers leave no transition record


def test_start_incident_twice_is_illegal():
    m = IncidentStateMachine()
    m.start_incident()
    with pytest.raises(IllegalTransitionError):
        m.start_incident()


def test_tool_calls_illegal_when_context_not_running():
    m = IncidentStateMachine()
    m.start_incident()
    m.start_transcription()
    with pytest.raises(IllegalTransitionError, match="context track is not running"):
        m.record_tool_call()
    with pytest.raises(IllegalTransitionError, match="context track is not running"):
        m.record_tool_result()


def test_terminal_states_accept_no_transition():
    m = machine_at_awaiting_approval()
    drive_to_completed(m)
    assert m.state in TERMINAL_STATES
    with pytest.raises(IllegalTransitionError):
        m.start_incident()
    with pytest.raises(IllegalTransitionError):
        m.fail_with_fallback("too late")
    m2 = IncidentStateMachine()
    m2.start_incident()
    m2.fail_with_fallback("vllm down")
    with pytest.raises(IllegalTransitionError):
        m2.start_dispatch()
    with pytest.raises(IllegalTransitionError):
        m2.fail_with_fallback("again")


def test_fail_with_fallback_from_any_non_terminal_state():
    # From intake.
    m = IncidentStateMachine()
    m.start_incident()
    events = m.fail_with_fallback("stt crashed")
    assert m.state is IncidentState.FAILED_WITH_FALLBACK
    types = [e.event_type for e in events]
    assert EventType.ERROR in types
    assert EventType.FALLBACK_ACTIVATED in types
    # From awaiting approval.
    m2 = machine_at_awaiting_approval()
    m2.fail_with_fallback("network lost")
    assert m2.state is IncidentState.FAILED_WITH_FALLBACK
    assert m2.audit_trail[-1].details["reason"] == "network lost"


# --------------------------------------------------------------------- #
# Audit trail
# --------------------------------------------------------------------- #


def test_audit_trail_records_every_transition_with_timestamps():
    m = machine_at_awaiting_approval()
    drive_to_completed(m)
    trail = m.audit_trail
    assert len(trail) > 0
    # Contiguous indices, chained states, parseable timestamps.
    for i, record in enumerate(trail):
        assert record.index == i + 1
        datetime.fromisoformat(record.timestamp.replace("Z", "+00:00"))
        assert len(record.emitted_event_types) >= 1
        assert len(record.emitted_event_ids) == len(record.emitted_event_types)
    for prev, nxt in zip(trail, trail[1:]):
        assert nxt.from_state == prev.to_state
    assert trail[0].from_state is IncidentState.IDLE
    assert trail[-1].to_state is IncidentState.COMPLETED
    # Timestamps are monotonically non-decreasing.
    stamps = [datetime.fromisoformat(r.timestamp.replace("Z", "+00:00")) for r in trail]
    assert stamps == sorted(stamps)


def test_audit_trail_preserved_across_plan_revisions():
    m = machine_at_awaiting_approval()
    m.record_approval_decision(ApprovalDecision.MODIFY)
    m.submit_draft_plan()
    m.complete_safety_review(SafetyReviewStatus.PASS)
    m.record_approval_decision(ApprovalDecision.APPROVE)
    triggers = [r.trigger for r in m.audit_trail]
    assert triggers.count("submit_draft_plan") == 2
    assert triggers.count("record_approval_decision") == 2
    versions = [r.plan_version for r in m.audit_trail]
    assert max(versions) == 2  # nothing deleted, versions only grow
    assert len(m.approval_decisions) == 2


def test_audit_records_are_immutable():
    m = IncidentStateMachine()
    m.start_incident()
    record = m.audit_trail[0]
    with pytest.raises(Exception):
        record.trigger = "tampered"


# --------------------------------------------------------------------- #
# Event emission and contract validity
# --------------------------------------------------------------------- #


def test_event_type_enum_matches_contract_schema_exactly():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    schema_enum = set(schema["properties"]["event_type"]["enum"])
    assert {e.value for e in EventType} == schema_enum


def test_every_transition_emits_contract_valid_events():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    schema_enum = set(schema["properties"]["event_type"]["enum"])
    required = set(schema["required"])

    m = machine_at_awaiting_approval()
    m.record_approval_decision(ApprovalDecision.MODIFY)
    m.submit_draft_plan()
    m.complete_safety_review(SafetyReviewStatus.PASS)
    m.record_approval_decision(ApprovalDecision.APPROVE)
    m.start_dispatch()
    m.record_dispatch_instruction()
    m.record_tts_started()
    m.record_tts_ready()
    m.mark_dispatched()
    m.complete_incident()

    assert len(m.emitted_events) >= len(m.audit_trail)  # >= 1 event per transition
    for envelope in m.emitted_events:
        data = envelope.to_dict()
        # Required fields per contract.
        assert required.issubset(data.keys())
        # Types and constraints per contract.
        assert isinstance(data["event_id"], str) and data["event_id"]
        assert data["incident_id"] == m.incident_id
        assert data["event_type"] in schema_enum
        datetime.fromisoformat(data["timestamp"].replace("Z", "+00:00"))
        assert isinstance(data["sequence"], int) and data["sequence"] >= 1
        assert isinstance(data["payload"], dict)
    # Monotonically increasing sequence, starting at 1, no gaps.
    sequences = [e.sequence for e in m.emitted_events]
    assert sequences == list(range(1, len(sequences) + 1))


def test_every_audit_record_references_valid_emitted_events():
    m = machine_at_awaiting_approval()
    drive_to_completed(m)
    by_id = {e.event_id: e for e in m.emitted_events}
    for record in m.audit_trail:
        for event_id, event_type in zip(record.emitted_event_ids, record.emitted_event_types):
            assert by_id[event_id].event_type is event_type


def test_listeners_receive_every_event_in_order():
    received = []
    m = IncidentStateMachine()
    m.add_listener(received.append)
    m2_received = []
    m.add_listener(m2_received.append)  # multiple observers supported
    m.start_incident()
    m.start_transcription()
    m.start_context_collection()
    assert [e.event_type for e in received] == [
        EventType.INCIDENT_STARTED,
        EventType.TRANSCRIPTION_STARTED,
        EventType.CONTEXT_AGENT_STARTED,
    ]
    assert received == m2_received == list(m.emitted_events)
    assert all(isinstance(e, EventEnvelope) for e in received)


def test_listener_can_be_removed():
    received = []
    m = IncidentStateMachine()
    m.add_listener(received.append)
    m.start_incident()
    m.remove_listener(received.append)
    m.receive_audio()
    assert len(received) == 1


def test_envelope_rejects_invalid_sequence_and_type():
    with pytest.raises(Exception):
        EventEnvelope(
            event_id="e",
            incident_id="i",
            event_type="not.a.valid.type",
            timestamp="2026-07-25T10:00:00+00:00",
            sequence=1,
            payload={},
        )
    with pytest.raises(Exception):
        EventEnvelope(
            event_id="e",
            incident_id="i",
            event_type=EventType.ERROR,
            timestamp="2026-07-25T10:00:00+00:00",
            sequence=0,  # schema minimum is 1
            payload={},
        )
    with pytest.raises(Exception):
        EventEnvelope(
            event_id="e",
            incident_id="i",
            event_type=EventType.ERROR,
            timestamp="not-a-date",
            sequence=1,
            payload={},
        )


def test_failed_trigger_emits_nothing():
    m = IncidentStateMachine()
    received = []
    m.add_listener(received.append)
    with pytest.raises(IllegalTransitionError):
        m.start_dispatch()
    assert received == []
    assert m.emitted_events == ()
    assert m.audit_trail == ()


# --------------------------------------------------------------------- #
# Escalation-to-human policy (issue #52)
# --------------------------------------------------------------------- #


def _machine_at_safety_review() -> IncidentStateMachine:
    m = IncidentStateMachine("incident-esc")
    m.start_incident()
    m.receive_audio()
    m.start_transcription()
    m.start_context_collection()
    m.record_tool_call()
    m.record_tool_result()
    m.transcript_ready()
    m.record_radio_event()
    m.complete_context_collection()
    m.complete_radio_extraction()
    m.submit_situation_snapshot()
    m.submit_draft_plan({"plan_id": "plan-esc"})
    assert m.state is IncidentState.SAFETY_REVIEW
    return m


def test_revise_escalated_after_bounded_revisions_reaches_human_gate():
    m = _machine_at_safety_review()
    review = {"critical_objections": ["[llm-critique/material] residual objection"]}
    envelopes = m.complete_safety_review(
        SafetyReviewStatus.REVISE, review, escalate_to_human=True
    )
    assert m.state is IncidentState.AWAITING_HUMAN_APPROVAL
    approval_req = [e for e in envelopes if e.event_type is EventType.APPROVAL_REQUESTED]
    assert len(approval_req) == 1
    payload = approval_req[0].payload
    assert payload["escalated_after_revisions"] is True
    assert payload["residual_objections"] == review["critical_objections"]
    assert m.audit_trail[-1].details["escalated_to_human"] is True


def test_block_is_never_escalated_even_with_the_flag():
    m = _machine_at_safety_review()
    m.complete_safety_review(
        SafetyReviewStatus.BLOCK, {"critical_objections": ["x"]}, escalate_to_human=True
    )
    assert m.state is IncidentState.REVISING_PLAN


def test_revise_without_escalation_flag_still_routes_to_revising():
    m = _machine_at_safety_review()
    m.complete_safety_review(SafetyReviewStatus.REVISE, escalate_to_human=False)
    assert m.state is IncidentState.REVISING_PLAN
