"""Tests for Agent 5 — Dispatch.

The vLLM server is MOCKED with respx (canned OpenAI-compatible responses).
No GPU and no network access are needed. The demo plan, approval decision and
reference dispatch messages come from ``contracts/mocks/demo_event_stream.jsonl``.
"""

from __future__ import annotations

import copy
import json
import logging
from pathlib import Path

import httpx
import jsonschema
import pytest
import respx

from agents.common.inference_client import GemmaClient
from agents.dispatch.agent import (
    AGENT_ID,
    DispatchAgent,
    DispatchGuardrailError,
    DispatchNotAuthorizedError,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
MOCK_STREAM_PATH = REPO_ROOT / "contracts" / "mocks" / "demo_event_stream.jsonl"
DISPATCH_SCHEMA = json.loads(
    (REPO_ROOT / "contracts" / "schemas" / "dispatch_instruction.schema.json").read_text(
        encoding="utf-8"
    )
)
UNITS = json.loads(
    (REPO_ROOT / "data" / "scenario" / "units.json").read_text(encoding="utf-8")
)

BASE_URL = "http://localhost:8000"
CHAT_URL = f"{BASE_URL}/v1/chat/completions"

UNIT_ORDER = ["alpha-3", "bravo-2", "charlie-1"]

#: Adversarial message: the approved action says North Access — Forest Track 5 is invented.
INVENTED_ROUTE_MESSAGE = (
    "Alpha 3, mission d'attaque annulée. Repli par la piste Forest Track 5 vers le "
    "point d'eau 2. D17 interdite aux CCF. Accusez réception."
)


# ---------------------------------------------------------------------------
# Fixtures: demo plan, approval decision and reference messages from the mock stream
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def demo():
    events = [
        json.loads(line)
        for line in MOCK_STREAM_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    plan = next(
        e["payload"]
        for e in events
        if e["event_type"] == "plan.draft.ready" and e["payload"]["plan_id"] == "plan-v2"
    )
    decision = next(
        e["payload"] for e in events if e["event_type"] == "approval.received"
    )
    references = {
        e["payload"]["unit_id"]: e["payload"]
        for e in events
        if e["event_type"] == "dispatch.instruction.ready"
    }
    assert decision["decision"] == "approve"
    assert set(references) == set(UNIT_ORDER)
    return plan, decision, references


def completion(payload: dict) -> httpx.Response:
    """One canned OpenAI-compatible chat completion whose content is a JSON payload."""
    return httpx.Response(
        200,
        json={
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "model": "google/gemma-4-E4B-it",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": json.dumps(payload, ensure_ascii=False),
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        },
    )


def reference_items(references: dict) -> list[dict]:
    return [
        {
            "unit_id": unit_id,
            "message_text": references[unit_id]["message_text"],
            "acknowledgement_required": references[unit_id]["acknowledgement_required"],
        }
        for unit_id in UNIT_ORDER
    ]


def make_client() -> GemmaClient:
    return GemmaClient(
        base_url=BASE_URL,
        model="google/gemma-4-E4B-it",
        retry_backoff_s=0.0,
        agent=AGENT_ID,
    )


# ---------------------------------------------------------------------------
# Demo scenario: 3 instructions matching the reference dispatches
# ---------------------------------------------------------------------------


@respx.mock
async def test_demo_plan_produces_reference_instructions(demo):
    plan, decision, references = demo
    route = respx.post(CHAT_URL).mock(
        return_value=completion({"instructions": reference_items(references)})
    )

    async with make_client() as client:
        agent = DispatchAgent(client)
        instructions = await agent.generate(plan, decision, UNITS)

    assert route.call_count == 1  # one batched LLM call
    assert client.call_log.cloud_calls == 0  # demo guard: 100% local

    assert [i["unit_id"] for i in instructions] == UNIT_ORDER
    assert [i["dispatch_id"] for i in instructions] == ["di-001", "di-002", "di-003"]

    for instruction in instructions:
        # Contract validation (also done internally by the agent).
        jsonschema.validate(instruction, DISPATCH_SCHEMA)
        assert instruction["plan_id"] == "plan-v2"
        assert instruction["dispatch_status"] == "pending"  # initial status
        assert instruction["tts_audio_path"] is None  # filled later by the TTS service
        # Messages match the reference dispatches of the demo stream.
        ref = references[instruction["unit_id"]]
        assert instruction["message_text"] == ref["message_text"]
        assert instruction["priority"] == ref["priority"]

    # Acknowledgement forced for high/critical priorities (all three demo actions).
    assert all(i["acknowledgement_required"] is True for i in instructions)


# ---------------------------------------------------------------------------
# Hard precondition: no human approval -> no LLM call at all
# ---------------------------------------------------------------------------


@respx.mock
async def test_reject_decision_raises_without_any_llm_call(demo):
    plan, decision, _ = demo
    respx.post(CHAT_URL).mock(return_value=completion({"instructions": []}))
    rejected = {**decision, "decision": "reject"}

    async with make_client() as client:
        agent = DispatchAgent(client)
        with pytest.raises(DispatchNotAuthorizedError):
            await agent.generate(plan, rejected, UNITS)

    assert len(respx.calls) == 0  # the LLM was never contacted
    assert client.call_log.total_calls == 0


@respx.mock
async def test_decision_for_another_plan_raises_without_any_llm_call(demo):
    plan, decision, _ = demo
    respx.post(CHAT_URL).mock(return_value=completion({"instructions": []}))
    mismatched = {**decision, "plan_id": "plan-v1"}

    async with make_client() as client:
        agent = DispatchAgent(client)
        with pytest.raises(DispatchNotAuthorizedError):
            await agent.generate(plan, mismatched, UNITS)

    assert len(respx.calls) == 0


# ---------------------------------------------------------------------------
# Guardrail 1: surplus LLM instruction for a unit outside the plan is rejected
# ---------------------------------------------------------------------------


@respx.mock
async def test_extra_instruction_for_unit_outside_plan_is_rejected(demo, caplog):
    plan, decision, references = demo
    items = reference_items(references) + [
        {
            "unit_id": "delta-4",
            "message_text": "Delta 4, engagez-vous sur le flanc est.",
            "acknowledgement_required": True,
        }
    ]
    respx.post(CHAT_URL).mock(return_value=completion({"instructions": items}))

    caplog.set_level(logging.ERROR, logger="blaze.dispatch")
    async with make_client() as client:
        agent = DispatchAgent(client)
        instructions = await agent.generate(plan, decision, UNITS)

    assert [i["unit_id"] for i in instructions] == UNIT_ORDER  # delta-4 never dispatched
    assert not any(i["unit_id"] == "delta-4" for i in instructions)
    assert "delta-4" in caplog.text and "no approved action" in caplog.text


# ---------------------------------------------------------------------------
# Guardrail 2: lexical anti-invention check (closed scenario vocabulary)
# ---------------------------------------------------------------------------


@respx.mock
async def test_invented_route_is_rejected_then_regenerated(demo, caplog):
    plan, decision, references = demo
    good_items = reference_items(references)
    bad_items = copy.deepcopy(good_items)
    bad_items[0]["message_text"] = INVENTED_ROUTE_MESSAGE  # Forest Track 5 invented

    route = respx.post(CHAT_URL)
    route.side_effect = [
        completion({"instructions": bad_items}),  # batch: alpha-3 invents a route
        completion(good_items[0]),  # unit-scoped regeneration: faithful message
    ]

    caplog.set_level(logging.ERROR, logger="blaze.dispatch")
    async with make_client() as client:
        agent = DispatchAgent(client)
        instructions = await agent.generate(plan, decision, UNITS)

    assert route.call_count == 2  # 1 batch + 1 regeneration for alpha-3 only
    assert instructions[0]["unit_id"] == "alpha-3"
    assert instructions[0]["message_text"] == references["alpha-3"]["message_text"]
    assert "forest-track-5" in caplog.text  # invented location detected lexically
    assert "north-access" in caplog.text  # approved route missing from the message


@respx.mock
async def test_invented_route_exhausts_regenerations_and_raises(demo):
    plan, decision, references = demo
    bad_items = reference_items(references)
    bad_items[0]["message_text"] = INVENTED_ROUTE_MESSAGE
    bad_regen = {
        "unit_id": "alpha-3",
        "message_text": INVENTED_ROUTE_MESSAGE,
        "acknowledgement_required": True,
    }

    route = respx.post(CHAT_URL)
    route.side_effect = [
        completion({"instructions": bad_items}),
        completion(bad_regen),  # regeneration still invents -> typed error
    ]

    async with make_client() as client:
        agent = DispatchAgent(client, max_regenerations=1)
        with pytest.raises(DispatchGuardrailError) as excinfo:
            await agent.generate(plan, decision, UNITS)

    assert route.call_count == 2  # initial batch + the single allowed regeneration
    assert excinfo.value.unit_id == "alpha-3"
    assert excinfo.value.attempts == 2
    assert any("forest-track-5" in v for v in excinfo.value.violations)


@respx.mock
async def test_missing_unit_instruction_is_regenerated(demo):
    plan, decision, references = demo
    items = reference_items(references)[:2]  # LLM forgot charlie-1

    route = respx.post(CHAT_URL)
    route.side_effect = [
        completion({"instructions": items}),
        completion(reference_items(references)[2]),  # regeneration for charlie-1
    ]

    async with make_client() as client:
        agent = DispatchAgent(client)
        instructions = await agent.generate(plan, decision, UNITS)

    assert route.call_count == 2
    assert [i["unit_id"] for i in instructions] == UNIT_ORDER
    assert instructions[2]["message_text"] == references["charlie-1"]["message_text"]


# ---------------------------------------------------------------------------
# Guardrail 3: acknowledgement forced on high/critical priorities
# ---------------------------------------------------------------------------


@respx.mock
async def test_acknowledgement_forced_on_critical_action():
    plan = {
        "plan_id": "plan-x",
        "incident_id": "wildfire-demo-01",
        "version": 1,
        "summary": "test",
        "objectives": [],
        "unit_actions": [
            {
                "action_id": "ua-1",
                "unit_id": "alpha-3",
                "action_type": "retreat",
                "instruction": "Repli immédiat par l'accès nord",
                "route": "north-access",
                "destination": None,
                "reason": "test",
                "priority": "critical",
                "evidence_ids": [],
                "confidence": 0.9,
                "human_approval_required": True,
                "acknowledgement_required": False,  # forgotten upstream on purpose
            }
        ],
        "created_at": "2026-07-25T10:00:00Z",
    }
    decision = {
        "decision_id": "ad-x",
        "plan_id": "plan-x",
        "decision": "approve",
        "operator_name": "IC",
        "operator_note": None,
        "modified_actions": [],
        "decided_at": "2026-07-25T10:00:01Z",
    }
    respx.post(CHAT_URL).mock(
        return_value=completion(
            {
                "instructions": [
                    {
                        "unit_id": "alpha-3",
                        "message_text": "Alpha 3, repli immédiat par l'accès nord.",
                        "acknowledgement_required": False,  # LLM got it wrong too
                    }
                ]
            }
        )
    )

    async with make_client() as client:
        agent = DispatchAgent(client)
        instructions = await agent.generate(plan, decision)

    assert len(instructions) == 1
    assert instructions[0]["acknowledgement_required"] is True  # forced deterministically
    jsonschema.validate(instructions[0], DISPATCH_SCHEMA)


# ---------------------------------------------------------------------------
# decision == "modify": operator-modified actions are what gets dispatched
# ---------------------------------------------------------------------------


@respx.mock
async def test_modify_decision_dispatches_operator_modified_action(demo):
    plan, decision, references = demo
    modified_charlie = {
        **next(a for a in plan["unit_actions"] if a["unit_id"] == "charlie-1"),
        "action_type": "hold_position",
        "instruction": "La D17 est fermée à tous les véhicules. Restez en position sécurisée.",
        "destination": None,
    }
    modify_decision = {
        **decision,
        "decision": "modify",
        "modified_actions": [modified_charlie],
    }
    charlie_message = (
        "Charlie 1, la D17 est fermée à tous les véhicules. Restez en position "
        "sécurisée. Accusez réception."
    )
    items = reference_items(references)[:2] + [
        {
            "unit_id": "charlie-1",
            "message_text": charlie_message,
            "acknowledgement_required": True,
        }
    ]
    respx.post(CHAT_URL).mock(return_value=completion({"instructions": items}))

    async with make_client() as client:
        agent = DispatchAgent(client)
        instructions = await agent.generate(plan, modify_decision, UNITS)

    assert [i["unit_id"] for i in instructions] == UNIT_ORDER
    assert instructions[2]["message_text"] == charlie_message
    for instruction in instructions:
        jsonschema.validate(instruction, DISPATCH_SCHEMA)
