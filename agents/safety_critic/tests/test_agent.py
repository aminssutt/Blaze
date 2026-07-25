"""Tests for the hybrid SafetyCriticAgent (rules engine + adversarial LLM critique).

The vLLM server is MOCKED with respx (OpenAI-compatible /v1/chat/completions) —
no GPU and no network needed. Gemma answers are canned JSON critiques so the hard
merge policy can be exercised deterministically, including the anti-complacency
guarantee: a mechanical fail can NEVER be turned into a pass by the LLM.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import jsonschema
import pytest
import respx

from agents.common.inference_client import GemmaClient
from agents.safety_critic.agent import SafetyCriticAgent, load_safety_review_schema
from agents.safety_critic.rules import load_safety_rules

BASE_URL = "http://localhost:8000"
CHAT_URL = f"{BASE_URL}/v1/chat/completions"
MODEL_ID = "google/gemma-4-E4B-it"

NOW = datetime(2026, 7, 25, 14, 0, 0, tzinfo=timezone.utc)

SEEDED_RULES = load_safety_rules()
SAFETY_REVIEW_SCHEMA = load_safety_review_schema()

LLM_ALL_CLEAR = {
    "recommended_status": "pass",
    "objections": [],
    "required_changes": [],
    "required_confirmations": [],
}

LLM_MATERIAL_OBJECTION = {
    "recommended_status": "revise",
    "objections": [
        {
            "objection": (
                "Radio re-002 reports smoke turning toward sector B12 while the plan assumes a "
                "stable wind; Alpha 3's attack axis could be cut mid-operation."
            ),
            "severity": "material",
            "evidence": ["radio:re-002", "plan.assumptions[0]"],
        }
    ],
    "required_changes": ["Re-plan the Alpha 3 attack axis against the reported wind shift."],
    "required_confirmations": ["Confirm wind direction with the command post before engagement."],
}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("BLAZE_ALLOW_REMOTE_INFERENCE", raising=False)
    monkeypatch.delenv("VLLM_BASE_URL", raising=False)
    monkeypatch.delenv("VLLM_API_KEY", raising=False)
    monkeypatch.delenv("GEMMA_MODEL_ID", raising=False)


def completion_body(content: str) -> dict:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": MODEL_ID,
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 200, "completion_tokens": 80, "total_tokens": 280},
    }


def mock_llm_critique(critique: dict) -> None:
    respx.post(CHAT_URL).mock(
        return_value=httpx.Response(200, json=completion_body(json.dumps(critique)))
    )


def make_client(**kwargs) -> GemmaClient:
    kwargs.setdefault("base_url", BASE_URL)
    kwargs.setdefault("model", MODEL_ID)
    kwargs.setdefault("agent", "safety_critic")
    kwargs.setdefault("retry_backoff_s", 0.0)
    return GemmaClient(**kwargs)


def make_agent(client: GemmaClient) -> SafetyCriticAgent:
    return SafetyCriticAgent(client, rules=SEEDED_RULES)


# ---------------------------------------------------------------------------
# Fixtures: units / snapshot / plans
# ---------------------------------------------------------------------------


def make_units(alpha_water: float = 65) -> list[dict]:
    return [
        {"unit_id": "alpha-3", "callsign": "Alpha 3", "vehicle_type": "CCF", "water_pct": alpha_water},
        {"unit_id": "bravo-2", "callsign": "Bravo 2", "vehicle_type": "light_vehicle", "water_pct": None},
        {"unit_id": "charlie-1", "callsign": "Charlie 1", "vehicle_type": "light_vehicle", "water_pct": None},
    ]


def make_snapshot(**overrides) -> dict:
    snapshot = {
        "incident_id": "wildfire-demo-01",
        "version": 3,
        "radio_events": ["re-001", "re-002"],
        "weather": {"temperature_c": 34, "wind_speed_kmh": 30, "visibility": "good"},
        "roads": [
            {
                "road_id": "d17",
                "status": "open",
                "allowed_vehicle_types": ["CCF", "light_vehicle", "command_post"],
                "restrictions": [],
            },
            {
                "road_id": "north-access",
                "status": "open",
                "allowed_vehicle_types": ["CCF", "light_vehicle", "command_post"],
                "restrictions": [],
            },
        ],
        "known_facts": [],
        "uncertain_facts": [],
        "conflicts": [],
        "missing_information": [],
        "provenance": [
            {
                "field": "roads",
                "source_type": "seeded_demo",
                "source_name": "scenario-roads",
                "retrieved_at": (NOW - timedelta(minutes=2)).isoformat(),
            }
        ],
        "generated_at": NOW.isoformat(),
    }
    snapshot.update(overrides)
    return snapshot


def make_action(**overrides) -> dict:
    action = {
        "action_id": "act-attack-alpha3",
        "unit_id": "alpha-3",
        "action_type": "attack",
        "instruction": "Direct attack on the fire edge in sector B12.",
        "route": "north-access",
        "destination": "sector-b12",
        "reason": "Contain the head of the fire before it reaches the camping.",
        "priority": "high",
        "evidence_ids": ["re-001", "re-002"],
        "confidence": 0.85,
        "human_approval_required": True,
        "acknowledgement_required": True,
    }
    action.update(overrides)
    return action


def retreat_action(unit_id: str = "alpha-3") -> dict:
    return make_action(
        action_id=f"act-retreat-{unit_id}",
        unit_id=unit_id,
        action_type="retreat",
        route="north-access",
        destination="water-point-2",
        instruction="If threatened, retreat via North Access toward Water Point 2.",
        reason="Mandatory retreat option for the engaged unit.",
    )


def make_plan(actions: list[dict], **overrides) -> dict:
    plan = {
        "plan_id": "plan-demo-v1",
        "incident_id": "wildfire-demo-01",
        "version": 1,
        "summary": "Alpha 3 direct attack on sector B12; Bravo 2 reconnaissance.",
        "objectives": ["Contain sector B12", "Protect the camping"],
        "unit_actions": actions,
        "assumptions": ["Wind remains steady from the north."],
        "uncertainties": ["Exact fire-front position in B12."],
        "created_at": NOW.isoformat(),
    }
    plan.update(overrides)
    return plan


def clean_plan() -> dict:
    return make_plan([make_action(), retreat_action()])


def rule_status(review: dict, rule_id: str) -> dict:
    return next(c for c in review["rule_checks"] if c["rule_id"] == rule_id)


# ---------------------------------------------------------------------------
# Demo plan v1: Alpha 3 attacks at 30% water (refill plan required) in the
# demo visibility case -> revise with at least one material objection.
# ---------------------------------------------------------------------------


@respx.mock
async def test_demo_plan_v1_gets_revise_with_material_objection():
    mock_llm_critique(LLM_MATERIAL_OBJECTION)
    # Demo case: water 30% (above the REAL seeded 20% hard threshold, below the 35%
    # refill threshold, no refill plan) + near-zero visibility while attacking.
    snapshot = make_snapshot(weather={"visibility": "near_zero", "wind_speed_kmh": 30})
    async with make_client() as client:
        review = await make_agent(client).review(clean_plan(), snapshot, make_units(alpha_water=30))

    assert review["status"] == "revise"
    assert len(review["critical_objections"]) >= 1
    joined = " ".join(review["critical_objections"])
    assert "sr-min-water" in joined and "sr-visibility" in joined  # genuine material objections
    assert rule_status(review, "sr-min-water")["passed"] is False
    assert rule_status(review, "sr-visibility")["passed"] is False
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


@respx.mock
async def test_attack_at_15pct_water_truly_violates_hard_threshold_and_blocks():
    mock_llm_critique(LLM_ALL_CLEAR)
    async with make_client() as client:
        review = await make_agent(client).review(
            clean_plan(), make_snapshot(), make_units(alpha_water=15)
        )
    assert review["status"] == "block"
    assert rule_status(review, "sr-min-water")["passed"] is False
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


# ---------------------------------------------------------------------------
# CCF routed on restricted D17 -> compatibility fail
# ---------------------------------------------------------------------------


@respx.mock
async def test_ccf_on_restricted_d17_fails_compatibility():
    mock_llm_critique(LLM_ALL_CLEAR)
    snapshot = make_snapshot(
        roads=[
            {
                "road_id": "d17",
                "status": "open",
                "allowed_vehicle_types": ["light_vehicle"],
                "restrictions": [{"vehicle_type": "CCF", "reason": "restricted to light vehicles"}],
            },
            {
                "road_id": "north-access",
                "status": "open",
                "allowed_vehicle_types": ["CCF", "light_vehicle", "command_post"],
                "restrictions": [],
            },
        ]
    )
    plan = make_plan([make_action(route="d17"), retreat_action()])
    async with make_client() as client:
        review = await make_agent(client).review(plan, snapshot, make_units())

    compat = rule_status(review, "sr-vehicle-road-compat")
    assert compat["passed"] is False
    assert review["status"] == "block"
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


# ---------------------------------------------------------------------------
# Anti-complacency: the LLM can NEVER turn a mechanical fail into a pass
# ---------------------------------------------------------------------------


@respx.mock
async def test_llm_saying_all_good_cannot_override_mechanical_fail():
    # Canned Gemma answer: "everything is fine, pass" — on a plan with a hard
    # mechanical failure (attack at 15% water). Status MUST stay revise/block.
    mock_llm_critique(
        {
            "recommended_status": "pass",
            "objections": [],
            "required_changes": [],
            "required_confirmations": ["Plan looks perfectly safe to me."],
        }
    )
    async with make_client() as client:
        review = await make_agent(client).review(
            clean_plan(), make_snapshot(), make_units(alpha_water=15)
        )
    assert review["status"] in {"revise", "block"}
    assert review["status"] == "block"  # water below hard threshold escalates to block
    assert any("sr-min-water" in o for o in review["critical_objections"])
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


@respx.mock
async def test_llm_pass_on_revise_level_fail_stays_revise():
    mock_llm_critique(LLM_ALL_CLEAR)
    # 30% water without refill plan: mechanical fail with revise escalation.
    async with make_client() as client:
        review = await make_agent(client).review(
            clean_plan(), make_snapshot(), make_units(alpha_water=30)
        )
    assert review["status"] == "revise"
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


# ---------------------------------------------------------------------------
# Clean plan + no LLM objection -> pass (ready for human review, not approved)
# ---------------------------------------------------------------------------


@respx.mock
async def test_clean_plan_with_no_llm_objection_passes():
    mock_llm_critique(LLM_ALL_CLEAR)
    async with make_client() as client:
        review = await make_agent(client).review(clean_plan(), make_snapshot(), make_units())

    assert review["status"] == "pass"
    assert review["critical_objections"] == []
    assert all(c["passed"] for c in review["rule_checks"])
    # A pass never replaces the human commander.
    assert any("human" in c.lower() for c in review["required_confirmations"])
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


@respx.mock
async def test_llm_material_objection_escalates_clean_plan_to_revise():
    mock_llm_critique(LLM_MATERIAL_OBJECTION)
    async with make_client() as client:
        review = await make_agent(client).review(clean_plan(), make_snapshot(), make_units())

    assert review["status"] == "revise"
    assert any("llm-critique/material" in o for o in review["critical_objections"])
    # Mechanical checks were all green: the LLM only ADDED an objection.
    assert all(c["passed"] for c in review["rule_checks"])
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


@respx.mock
async def test_llm_block_recommendation_alone_is_capped_at_revise():
    mock_llm_critique(
        {
            "recommended_status": "block",
            "objections": [
                {"objection": "I do not like this plan at all.", "severity": "material", "evidence": []}
            ],
            "required_changes": [],
            "required_confirmations": [],
        }
    )
    async with make_client() as client:
        review = await make_agent(client).review(clean_plan(), make_snapshot(), make_units())
    # Without mechanical evidence the LLM alone cannot block, only force a revision.
    assert review["status"] == "revise"
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


# ---------------------------------------------------------------------------
# Hazmat: unconfirmed hazardous material without perimeter -> fail
# ---------------------------------------------------------------------------


@respx.mock
async def test_unconfirmed_hazmat_without_perimeter_fails_and_blocks():
    mock_llm_critique(LLM_ALL_CLEAR)
    snapshot = make_snapshot(
        uncertain_facts=["Gas cylinders reported near the hangar — unconfirmed"]
    )
    async with make_client() as client:
        review = await make_agent(client).review(clean_plan(), snapshot, make_units())

    hazmat = rule_status(review, "sr-hazmat-perimeter")
    assert hazmat["passed"] is False
    assert review["status"] == "block"
    assert any("sr-hazmat-perimeter" in o for o in review["critical_objections"])
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


# ---------------------------------------------------------------------------
# LLM failure degrades safely (rules-only, floored at revise, never silent pass)
# ---------------------------------------------------------------------------


@respx.mock
async def test_llm_failure_degrades_to_rules_only_and_floors_at_revise():
    respx.post(CHAT_URL).mock(return_value=httpx.Response(500, text="vLLM down"))
    async with make_client(max_retries=0) as client:
        review = await make_agent(client).review(clean_plan(), make_snapshot(), make_units())

    assert review["status"] == "revise"  # adversarial layer missing => never a silent pass
    assert any("unavailable" in c for c in review["required_confirmations"])
    assert all(c["passed"] for c in review["rule_checks"])  # mechanical output still complete
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)


# ---------------------------------------------------------------------------
# Schema conformance + complete mechanical output
# ---------------------------------------------------------------------------


@respx.mock
async def test_review_validates_against_safety_review_schema_and_lists_all_rules():
    mock_llm_critique(LLM_ALL_CLEAR)
    async with make_client() as client:
        review = await make_agent(client).review(clean_plan(), make_snapshot(), make_units())

    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)
    rule_ids = [c["rule_id"] for c in review["rule_checks"]]
    for seeded in (
        "sr-retreat-route",
        "sr-vehicle-road-compat",
        "sr-min-water",
        "sr-visibility",
        "sr-hazmat-perimeter",
        "sr-human-approval",
    ):
        assert seeded in rule_ids
    assert "sc-data-staleness" in rule_ids and "sc-single-weak-source" in rule_ids
    for check in review["rule_checks"]:
        assert isinstance(check["passed"], bool)
        assert check["detail"]
    assert review["plan_id"] == "plan-demo-v1"
    assert review["review_id"].startswith("sr-")


@respx.mock
async def test_warnings_are_reported_as_confirmations_not_failures():
    mock_llm_critique(LLM_ALL_CLEAR)
    snapshot = make_snapshot(
        provenance=[
            {
                "field": "fire_hotspots",
                "source_type": "cached_public",
                "source_name": "nasa-firms-cache",
                "retrieved_at": (NOW - timedelta(hours=3)).isoformat(),
            }
        ]
    )
    async with make_client() as client:
        review = await make_agent(client).review(clean_plan(), snapshot, make_units())

    stale = rule_status(review, "sc-data-staleness")
    assert stale["passed"] is True  # a warning is flagged, not a hard failure
    assert stale["detail"].startswith("WARNING:")
    assert any("sc-data-staleness" in c for c in review["required_confirmations"])
    assert review["status"] == "pass"
    jsonschema.validate(review, SAFETY_REVIEW_SCHEMA)
