"""Contract-schema validation on plan intake (finding from #55).

A plan whose actions use non-contract fields (e.g. `description` instead of
`instruction`) used to be accepted silently — and later degraded the Dispatch
Agent to generic "aucune instruction spécifique fournie" messages. Intake now
rejects contract violations with an explicit 422.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]


def valid_plan(plan_id: str = "plan-valid") -> dict:
    return {
        "plan_id": plan_id,
        "incident_id": "wildfire-demo-01",
        "version": 1,
        "summary": "Retreat and containment",
        "objectives": ["protect units"],
        "unit_actions": [
            {
                "action_id": f"{plan_id}-a1",
                "unit_id": "alpha-3",
                "action_type": "retreat",
                "instruction": "Repli via North Access vers Water Point 2",
                "route": "north-access",
                "destination": "water-point-2",
                "reason": "eau à 30%",
                "priority": "critical",
                "evidence_ids": [],
                "confidence": 0.9,
                "human_approval_required": True,
                "acknowledgement_required": True,
            }
        ],
        "created_at": "2026-07-25T10:00:00Z",
    }


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/incident/reset")
        yield c
        c.post("/incident/reset")


def test_valid_contract_plan_is_accepted(client):
    assert client.post("/plans", json=valid_plan()).status_code == 200


def test_plan_with_non_contract_action_field_is_rejected(client):
    plan = valid_plan("plan-desc")
    action = plan["unit_actions"][0]
    del action["instruction"]
    action["description"] = "Repli via North Access"  # the exact #55 mistake
    resp = client.post("/plans", json=plan)
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["contract"] == "draft_tactical_plan"
    assert any("instruction" in err for err in detail["errors"])


def test_plan_missing_required_top_level_list_is_rejected(client):
    plan = valid_plan("plan-badtop")
    plan["unit_actions"] = "not-a-list"
    assert client.post("/plans", json=plan).status_code == 422


def test_modify_with_non_contract_actions_is_rejected(client):
    assert client.post("/plans", json=valid_plan("plan-mod")).status_code == 200
    bad_actions = [dict(valid_plan("plan-mod")["unit_actions"][0])]
    del bad_actions[0]["instruction"]
    bad_actions[0]["description"] = "texte hors contrat"
    resp = client.post(
        "/approval/decision",
        json={
            "plan_id": "plan-mod",
            "decision": "modify",
            "operator_name": "cdt",
            "modified_actions": bad_actions,
        },
    )
    assert resp.status_code == 422
    # No v2 was minted, no decision recorded.
    plans = client.get("/plans").json()
    assert len(plans["plans"]) == 1
    assert plans["decisions"] == []


def test_mock_stream_plans_pass_validation(client):
    # The #114 live-mode compensation re-submits replayed plans through this
    # endpoint — the frozen mock plans must keep passing.
    for line in (REPO_ROOT / "contracts" / "mocks" / "demo_event_stream.jsonl").read_text().splitlines():
        event = json.loads(line)
        if event.get("event_type") == "plan.draft.ready":
            resp = client.post("/plans", json=event["payload"])
            assert resp.status_code == 200, resp.json()
