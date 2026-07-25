"""Tests for the Tactical Fusion & Planning agent (Agent 3).

Gemma is MOCKED with respx (canned OpenAI-compatible /v1/chat/completions bodies)
so no GPU / vLLM server is needed. Scenario data mirrors the demo event stream
(contracts/mocks/demo_event_stream.jsonl) and data/scenario/{units,roads}.json:
Alpha 3 (CCF) must retreat via North Access to Water Point 2 because of low water,
near-zero visibility and the D17 CCF restriction; the Charlie 1 correction (audio 4)
triggers a re-plan that produces version 2 while version 1 stays intact.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import httpx
import pytest
import respx

from agents.common.inference_client import GemmaClient
from agents.tactical_planning.agent import (
    DraftTacticalPlan,
    PlanHistory,
    TacticalPlanningAgent,
    load_plan_validator,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
BASE_URL = "http://localhost:8000"
CHAT_URL = f"{BASE_URL}/v1/chat/completions"
MODEL_ID = "google/gemma-4-E4B-it"

# ---------------------------------------------------------------------------
# Scenario fixtures (mirroring contracts/mocks/demo_event_stream.jsonl)
# ---------------------------------------------------------------------------

RE_001 = {
    "event_id": "re-001",
    "audio_id": "audio_01",
    "unit_id": "alpha-3",
    "event_type": "hazard_report",
    "location_reference": "hangar",
    "facts": ["Dense black smoke near the industrial hangar", "Multiple explosions heard"],
    "urgency": "high",
    "confidence": 0.9,
    "confirmation_status": "reported",
    "is_correction": False,
    "corrects_event_id": None,
    "uncertainties": ["Explosions heard but not confirmed"],
    "evidence_text": "fumée noire très dense près du hangar [...] on entend plusieurs explosions",
    "observed_at": "2026-07-25T10:00:06.100Z",
    "source_type": "human_report",
}

RE_002 = {
    "event_id": "re-002",
    "audio_id": "audio_01",
    "unit_id": "alpha-3",
    "event_type": "road_status",
    "location_reference": "D17",
    "facts": ["D17 blocked for CCF heavy vehicle"],
    "urgency": "high",
    "confidence": 0.86,
    "confirmation_status": "reported",
    "is_correction": False,
    "corrects_event_id": None,
    "uncertainties": ["Blockage may be vehicle-type specific"],
    "evidence_text": "La D17 est bloquée pour notre CCF",
    "observed_at": "2026-07-25T10:00:06.400Z",
    "source_type": "human_report",
}

RE_003 = {
    "event_id": "re-003",
    "audio_id": "audio_02",
    "unit_id": "alpha-3",
    "event_type": "resource_update",
    "location_reference": None,
    "facts": ["Alpha 3 water level down to 30%", "Visibility near zero at Alpha 3 position"],
    "urgency": "critical",
    "confidence": 0.92,
    "confirmation_status": "reported",
    "is_correction": False,
    "corrects_event_id": None,
    "uncertainties": ["Exact remaining autonomy unknown"],
    "evidence_text": "il nous reste environ trente pour cent d'eau et la visibilité devient presque nulle",
    "observed_at": "2026-07-25T10:00:29.700Z",
    "source_type": "human_report",
}

RE_004 = {
    "event_id": "re-004",
    "audio_id": "audio_03",
    "unit_id": "bravo-2",
    "event_type": "wind_update",
    "location_reference": "D17",
    "facts": ["Wind shifted toward south-east", "Fire spreading much faster toward D17"],
    "urgency": "high",
    "confidence": 0.88,
    "confirmation_status": "reported",
    "is_correction": False,
    "corrects_event_id": None,
    "uncertainties": ["Field wind report conflicts with cached forecast (NW)"],
    "evidence_text": "le vent vient de tourner vers le sud-est. Le feu progresse beaucoup plus vite vers la D17",
    "observed_at": "2026-07-25T10:00:54.800Z",
    "source_type": "human_report",
}

# Audio 4 — Charlie 1 correction: D17 not fully blocked, light vehicles pass, CCF do not.
RE_005 = {
    "event_id": "re-005",
    "audio_id": "audio_04",
    "unit_id": "charlie-1",
    "event_type": "correction",
    "location_reference": "D17",
    "facts": [
        "D17 not fully blocked",
        "Light vehicles can still pass on D17",
        "CCF vehicles remain blocked on D17",
    ],
    "urgency": "medium",
    "confidence": 0.9,
    "confirmation_status": "reported",
    "is_correction": True,
    "corrects_event_id": "re-002",
    "uncertainties": ["Duration of light-vehicle accessibility unknown"],
    "evidence_text": "correction : la D17 n'est pas totalement bloquée. Les véhicules légers passent encore, mais pas les CCF",
    "observed_at": "2026-07-25T10:01:14.900Z",
    "source_type": "human_report",
}

EVENTS_V1 = [RE_001, RE_002, RE_003, RE_004]
EVENTS_V2 = EVENTS_V1 + [RE_005]

TOOL_CALL_IDS = ["tc-001", "tc-002", "tc-003", "tc-004", "tc-005", "tc-006", "tc-007"]


def make_snapshot(version: int = 1, radio_event_ids: list[str] | None = None) -> dict:
    return {
        "incident_id": "wildfire-demo-01",
        "version": version,
        "radio_events": radio_event_ids or ["re-001", "re-002", "re-003", "re-004"],
        "tool_call_ids": list(TOOL_CALL_IDS),
        "weather": {
            "temperature_c": 34.2,
            "relative_humidity_pct": 21,
            "wind_speed_kmh": 28,
            "wind_direction_deg": 320,
            "wind_gusts_kmh": 46,
        },
        "terrain": {"elevation_m": 118, "slope_estimate_pct": 7.5},
        "fire_hotspots": [{"lat": 43.4548, "lon": 3.7571, "frp_mw": 14.8, "confidence": "high"}],
        "roads": [
            {"road_id": "d17", "status": "blocked", "restricted_to": [], "note": "reported blocked for CCF"},
            {"road_id": "north-access", "status": "open", "restricted_to": []},
            {"road_id": "forest-track-5", "status": "open", "restricted_to": ["light_vehicle"]},
        ],
        "buildings_and_parcels": [
            {"id": "bat-hangar-d17", "type": "industrial_hangar", "lat": 43.4552, "lon": 3.7561}
        ],
        "critical_assets": [
            {"id": "camping-les-pins", "type": "camping", "lat": 43.4508, "lon": 3.765},
            {"id": "water-point-2", "type": "water_point", "lat": 43.4601, "lon": 3.7382},
        ],
        "units": [
            {"unit_id": "alpha-3", "water_pct": 30, "visibility": "near_zero", "mission": "suppression"},
            {"unit_id": "bravo-2", "mission": "reconnaissance"},
            {"unit_id": "charlie-1", "mission": "standby"},
        ],
        "resources": [
            {"resource_id": "water-point-2", "status": "available"},
            {"resource_id": "ccf-reserve-1", "status": "unavailable"},
        ],
        "known_facts": ["Dense black smoke near hangar", "Alpha 3 water at 30%", "D17 blocked for CCF (reported)"],
        "uncertain_facts": ["Explosions heard but unconfirmed"],
        "conflicts": ["Reported NW wind (open-meteo cache) vs evolving field conditions"],
        "missing_information": ["Confirmation of explosions"],
        "provenance": [
            {"field": "weather", "source_type": "cached_public", "source_name": "open-meteo"},
            {"field": "units", "source_type": "seeded_demo", "source_name": "scenario-units"},
        ],
        "generated_at": "2026-07-25T10:00:34.000Z",
    }


SNAPSHOT_V1 = make_snapshot(1)
SNAPSHOT_V2 = make_snapshot(2, ["re-001", "re-002", "re-003", "re-004", "re-005"])

UNITS = json.loads((REPO_ROOT / "data" / "scenario" / "units.json").read_text(encoding="utf-8"))

# ---------------------------------------------------------------------------
# Canned Gemma outputs (what the mocked LLM returns)
# ---------------------------------------------------------------------------

ALPHA_ACTION_V1 = {
    "unit_id": "alpha-3",
    "action_type": "retreat",
    "instruction": "Cancel suppression. Retreat via North Access to Water Point 2 and refill. D17 forbidden for CCF.",
    "route": "north-access",
    "destination": "water-point-2",
    "reason": "Water at 30%, near-zero visibility and D17 blocked for CCF make continued engagement unsafe.",
    "priority": "critical",
    "evidence_ids": ["re-002", "re-003", "tc-006"],
    "confidence": 0.9,
    "human_approval_required": True,
    "acknowledgement_required": True,
}

# Identical in v1 and v2 on purpose: an unchanged action must keep its action_id.
BRAVO_ACTION = {
    "unit_id": "bravo-2",
    "action_type": "reconnaissance",
    "instruction": "Hold stand-off reconnaissance of the hangar and report explosion status.",
    "route": None,
    "destination": "hangar-observation-point",
    "reason": "Explosions heard but unconfirmed; visual confirmation required from a safe distance.",
    "priority": "high",
    "evidence_ids": ["re-001"],
    "confidence": 0.85,
    "human_approval_required": True,
    "acknowledgement_required": True,
}

CHARLIE_ACTION_V1 = {
    "unit_id": "charlie-1",
    "action_type": "confirm_access",
    "instruction": "Scout D17 status and report accessibility per vehicle type.",
    "route": "d17",
    "destination": None,
    "reason": "D17 status must be kept current for routing decisions.",
    "priority": "medium",
    "evidence_ids": ["re-002"],
    "confidence": 0.8,
    "human_approval_required": False,
    "acknowledgement_required": False,
}

LLM_PLAN_V1 = {
    "summary": "Withdraw Alpha 3 via North Access to refill at Water Point 2; Bravo 2 confirms the hangar hazard; Charlie 1 keeps D17 status current.",
    "objectives": [
        "Protect crews first",
        "Preserve refill capability for Alpha 3",
        "Confirm explosion hazard at the hangar",
        "Keep D17 status current",
    ],
    "unit_actions": [ALPHA_ACTION_V1, BRAVO_ACTION, CHARLIE_ACTION_V1],
    "rejected_options": [
        {"option": "Send Alpha 3 through D17 to Sector B12", "reason": "D17 blocked for CCF"},
        {"option": "Use Forest Track 5 for Alpha 3", "reason": "Track not rated for CCF weight"},
    ],
    "assumptions": ["Water Point 2 available", "North Access remains open"],
    "uncertainties": ["Explosions heard but unconfirmed"],
    "evidence_ids": ["re-001", "re-002", "re-003", "re-004", "tc-001", "tc-006"],
}

ALPHA_ACTION_V2 = {
    **ALPHA_ACTION_V1,
    "instruction": "Attack mission cancelled. Retreat via North Access to Water Point 2. D17 confirmed impassable for CCF, light vehicles only.",
    "reason": "Correction confirms CCF still blocked on D17; water and visibility unchanged.",
    "evidence_ids": ["re-002", "re-003", "re-005", "tc-006"],
}

CHARLIE_ACTION_V2 = {
    **CHARLIE_ACTION_V1,
    "instruction": "Confirm D17 access for light vehicles only and mark the CCF restriction.",
    "reason": "Corrected road status (light vehicles pass, CCF blocked) needs field confirmation.",
    "priority": "high",
    "evidence_ids": ["re-004", "re-005"],
    "human_approval_required": False,  # must be forced to True by guardrail 5 (high priority)
    "acknowledgement_required": True,
}

LLM_PLAN_V2 = {
    "summary": "Maintain Alpha 3 retreat, hold Bravo 2 at stand-off, Charlie 1 confirms D17 light-vehicle access after the correction.",
    "objectives": [
        "Protect crews first",
        "Preserve refill capability",
        "Keep D17 status current after correction",
    ],
    "unit_actions": [ALPHA_ACTION_V2, BRAVO_ACTION, CHARLIE_ACTION_V2],
    "rejected_options": [
        {"option": "Reroute Alpha 3 back onto D17 after the correction", "reason": "Correction only opens D17 to light vehicles; CCF remain blocked"},
    ],
    "assumptions": ["Water Point 2 available", "North Access remains open"],
    "uncertainties": ["Duration of D17 light-vehicle accessibility unknown"],
    "evidence_ids": ["re-001", "re-002", "re-003", "re-004", "re-005", "tc-001", "tc-006"],
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def completion_body(content: str | None, tool_calls: list[dict] | None = None) -> dict:
    message: dict = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": MODEL_ID,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if tool_calls else "stop",
            }
        ],
        "usage": {"prompt_tokens": 900, "completion_tokens": 350, "total_tokens": 1250},
    }


def plan_response(plan: dict) -> httpx.Response:
    return httpx.Response(200, json=completion_body(json.dumps(plan)))


def mock_gemma(*responses: httpx.Response) -> respx.Route:
    return respx.post(CHAT_URL).mock(side_effect=list(responses))


@pytest.fixture
async def client():
    gemma = GemmaClient(base_url=BASE_URL, model=MODEL_ID, retry_backoff_s=0.0, agent="tactical_planning")
    yield gemma
    await gemma.aclose()


@pytest.fixture
def validator():
    return load_plan_validator()


def unit_action(plan: dict, unit_id: str) -> dict:
    matches = [a for a in plan["unit_actions"] if a["unit_id"] == unit_id]
    assert len(matches) == 1, f"expected exactly one action for {unit_id}"
    return matches[0]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@respx.mock
async def test_demo_scenario_v1_reroutes_alpha3(client, validator):
    """Demo scenario yields a credible v1 plan retreating Alpha 3 via North Access."""
    mock_gemma(plan_response(LLM_PLAN_V1))
    agent = TacticalPlanningAgent(client)

    plan = await agent.draft_plan(EVENTS_V1, SNAPSHOT_V1, UNITS)

    assert isinstance(plan, DraftTacticalPlan)
    assert plan["version"] == 1
    assert plan["incident_id"] == "wildfire-demo-01"
    assert plan["plan_id"].startswith("plan-v1-")
    assert plan["created_at"]  # generated by code

    alpha = unit_action(plan, "alpha-3")
    assert alpha["action_type"] == "retreat"
    assert alpha["route"] == "north-access"
    assert alpha["destination"] == "water-point-2"
    # Evidence: low water + visibility (re-003), D17 CCF restriction (re-002), routing tool (tc-006)
    assert {"re-002", "re-003", "tc-006"} <= set(alpha["evidence_ids"])
    assert alpha["priority"] == "critical"
    assert alpha["human_approval_required"] is True

    # Every action carries real evidence and the approval flag.
    for action in plan["unit_actions"]:
        assert action["evidence_ids"], f"action {action['action_id']} has no evidence"
        assert isinstance(action["human_approval_required"], bool)

    # CCF-incompatible alternatives were considered and rejected.
    rejected = " | ".join(r["reason"] for r in plan["rejected_options"]).lower()
    assert "ccf" in rejected

    # Unresolved snapshot conflict is flagged, not silently resolved.
    assert any("Unresolved conflict" in u for u in plan["uncertainties"])

    validator.validate(dict(plan))  # acceptance: matches draft_tactical_plan.schema.json
    assert agent.history.versions() == (1,)


@respx.mock
async def test_replan_after_audio4_correction_creates_v2_keeps_v1(client, validator):
    """Re-planning after the Charlie 1 correction yields v2; v1 stays intact in history."""
    mock_gemma(plan_response(LLM_PLAN_V1), plan_response(LLM_PLAN_V2))
    agent = TacticalPlanningAgent(client)

    plan_v1 = await agent.draft_plan(EVENTS_V1, SNAPSHOT_V1, UNITS)
    v1_frozen = copy.deepcopy(dict(plan_v1))

    plan_v2 = await agent.draft_plan(EVENTS_V2, SNAPSHOT_V2, UNITS, previous_plan=plan_v1)

    # Versioning is deterministic and code-owned.
    assert plan_v1["version"] == 1
    assert plan_v2["version"] == 2
    assert plan_v2["plan_id"] != plan_v1["plan_id"]

    # The previous plan object was NEVER mutated by the re-plan.
    assert dict(plan_v1) == v1_frozen

    # Append-only history keeps every version.
    assert agent.history.versions() == (1, 2)
    assert agent.history.get_version(1) == v1_frozen
    assert agent.history.latest()["version"] == 2

    # Mutating a returned historical copy cannot corrupt the stored history.
    stolen = agent.history.get_version(1)
    stolen["summary"] = "tampered"
    assert agent.history.get_version(1) == v1_frozen

    # Changed actions are listed; the untouched Bravo 2 action keeps its id.
    alpha_v2 = unit_action(plan_v2, "alpha-3")
    bravo_v1 = unit_action(plan_v1, "bravo-2")
    bravo_v2 = unit_action(plan_v2, "bravo-2")
    charlie_v2 = unit_action(plan_v2, "charlie-1")
    assert bravo_v2["action_id"] == bravo_v1["action_id"]
    assert set(plan_v2.changed_action_ids) == {alpha_v2["action_id"], charlie_v2["action_id"]}
    assert alpha_v2["action_id"] != unit_action(plan_v1, "alpha-3")["action_id"]

    # The correction updated the plan state (evidence now cites re-005).
    assert "re-005" in alpha_v2["evidence_ids"]
    assert "re-005" in charlie_v2["evidence_ids"]

    validator.validate(dict(plan_v2))


@respx.mock
async def test_invented_evidence_id_is_removed_with_uncertainty(client, validator):
    """Evidence ids hallucinated by the LLM are stripped and flagged as uncertainty."""
    tampered = copy.deepcopy(LLM_PLAN_V1)
    tampered["unit_actions"][0]["evidence_ids"] = ["re-003", "re-999"]  # re-999 does not exist
    tampered["evidence_ids"] = ["re-001", "re-999", "tc-424242"]
    mock_gemma(plan_response(tampered))
    agent = TacticalPlanningAgent(client)

    plan = await agent.draft_plan(EVENTS_V1, SNAPSHOT_V1, UNITS)

    alpha = unit_action(plan, "alpha-3")
    assert alpha["evidence_ids"] == ["re-003"]
    all_evidence = set(plan["evidence_ids"]) | {
        e for a in plan["unit_actions"] for e in a["evidence_ids"]
    }
    assert "re-999" not in all_evidence
    assert "tc-424242" not in all_evidence
    assert any("re-999" in u for u in plan["uncertainties"])
    assert any("tc-424242" in u for u in plan["uncertainties"])
    validator.validate(dict(plan))


@respx.mock
async def test_action_for_unknown_unit_is_rejected(client, validator):
    """Actions targeting units that do not exist are dropped and flagged."""
    tampered = copy.deepcopy(LLM_PLAN_V1)
    tampered["unit_actions"].append(
        {
            "unit_id": "delta-9",  # not in data/scenario/units.json
            "action_type": "suppression",
            "instruction": "Engage the fire front from the south.",
            "route": None,
            "destination": None,
            "reason": "Invented unit.",
            "priority": "high",
            "evidence_ids": ["re-001"],
            "confidence": 0.7,
            "human_approval_required": True,
            "acknowledgement_required": True,
        }
    )
    mock_gemma(plan_response(tampered))
    agent = TacticalPlanningAgent(client)

    plan = await agent.draft_plan(EVENTS_V1, SNAPSHOT_V1, UNITS)

    assert {a["unit_id"] for a in plan["unit_actions"]} == {"alpha-3", "bravo-2", "charlie-1"}
    assert any("delta-9" in u for u in plan["uncertainties"])
    validator.validate(dict(plan))


@respx.mock
async def test_high_and_critical_priorities_force_human_approval(client, validator):
    """human_approval_required is forced True for high/critical, whatever the LLM said."""
    tampered = copy.deepcopy(LLM_PLAN_V1)
    tampered["unit_actions"][0]["human_approval_required"] = False  # critical priority
    tampered["unit_actions"][1]["human_approval_required"] = False  # high priority
    mock_gemma(plan_response(tampered))
    agent = TacticalPlanningAgent(client)

    plan = await agent.draft_plan(EVENTS_V1, SNAPSHOT_V1, UNITS)

    for action in plan["unit_actions"]:
        if action["priority"] in {"high", "critical"}:
            assert action["human_approval_required"] is True, action["unit_id"]
    assert any("human_approval_required" in note for note in plan.guardrail_notes)
    validator.validate(dict(plan))


@respx.mock
async def test_llm_supplied_plan_metadata_is_overridden(client):
    """plan_id / version / created_at are code-generated even if the LLM invents them."""
    tampered = copy.deepcopy(LLM_PLAN_V1)
    tampered.update({"plan_id": "llm-made-up", "version": 42, "created_at": "bogus"})
    mock_gemma(plan_response(tampered))
    agent = TacticalPlanningAgent(client)

    plan = await agent.draft_plan(EVENTS_V1, SNAPSHOT_V1, UNITS)

    assert plan["version"] == 1
    assert plan["plan_id"] != "llm-made-up"
    assert plan["created_at"] != "bogus"


@respx.mock
async def test_compute_route_tool_round_feeds_evidence(client, validator):
    """The agent may request compute_route; the executed tool call id becomes valid evidence."""
    tool_call = {
        "id": "tc-100",
        "type": "function",
        "function": {
            "name": "compute_route",
            "arguments": json.dumps(
                {
                    "origin": "alpha-3-position",
                    "destination": "water-point-2",
                    "vehicle_type": "CCF",
                    "blocked_edges": ["d17"],
                }
            ),
        },
    }
    plan_with_tool_evidence = copy.deepcopy(LLM_PLAN_V1)
    plan_with_tool_evidence["unit_actions"][0]["evidence_ids"] = ["re-002", "re-003", "tc-100"]

    route = mock_gemma(
        httpx.Response(200, json=completion_body(None, tool_calls=[tool_call])),
        httpx.Response(200, json=completion_body("route received")),  # no more tool calls
        plan_response(plan_with_tool_evidence),
    )

    executed: list[tuple[str, dict]] = []

    def tool_executor(name: str, arguments: dict):
        executed.append((name, arguments))
        return {
            "selected_route": {"route_id": "north-access", "travel_time_min": 12, "vehicle_compatible": True},
            "rejected_routes": [{"route_id": "d17", "reason": "blocked_for_CCF"}],
        }

    agent = TacticalPlanningAgent(client, tool_executor=tool_executor)
    plan = await agent.draft_plan(EVENTS_V1, SNAPSHOT_V1, UNITS)

    assert executed == [
        (
            "compute_route",
            {
                "origin": "alpha-3-position",
                "destination": "water-point-2",
                "vehicle_type": "CCF",
                "blocked_edges": ["d17"],
            },
        )
    ]
    alpha = unit_action(plan, "alpha-3")
    assert "tc-100" in alpha["evidence_ids"]  # executed tool call accepted as evidence
    assert route.call_count == 3
    validator.validate(dict(plan))


def test_plan_history_is_append_only_and_isolated():
    history = PlanHistory()
    plan_a = {"plan_id": "p1", "version": 1, "summary": "a", "unit_actions": []}
    history.append(plan_a)
    plan_a["summary"] = "mutated-after-append"

    stored = history.get_version(1)
    assert stored["summary"] == "a"  # append made a defensive copy
    assert len(history) == 1
    assert history.versions() == (1,)

    history.append({"plan_id": "p2", "version": 2, "summary": "b", "unit_actions": []})
    assert history.versions() == (1, 2)
    assert history.get_version(1)["plan_id"] == "p1"
    assert history.latest()["plan_id"] == "p2"
    assert history.get_version(99) is None
    assert [p["plan_id"] for p in history.all()] == ["p1", "p2"]
