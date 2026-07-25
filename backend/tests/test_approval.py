import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft7Validator, RefResolver

from backend.api.config import REPO_ROOT
from backend.api.main import create_app

SCHEMA_DIR = REPO_ROOT / "contracts" / "schemas"
DECISION_SCHEMA = json.loads((SCHEMA_DIR / "approval_decision.schema.json").read_text())
# Resolve the relative $ref (unit_action.schema.json) from the local files
# instead of fetching the schemas' https://blaze.local $id namespace.
_STORE = {
    s["$id"]: s
    for s in (json.loads(p.read_text()) for p in SCHEMA_DIR.glob("*.schema.json"))
}
DECISION_VALIDATOR = Draft7Validator(
    DECISION_SCHEMA,
    resolver=RefResolver(
        base_uri=DECISION_SCHEMA["$id"], referrer=DECISION_SCHEMA, store=_STORE
    ),
)


def unit_action(unit_id: str, action_type: str) -> dict:
    """Contract-valid UnitAction (unit_action.schema.json)."""
    return {
        "action_id": f"ua-{unit_id}-{action_type}",
        "unit_id": unit_id,
        "action_type": action_type,
        "instruction": f"{unit_id}: {action_type}",
        "reason": "operator modification",
        "priority": "high",
        "evidence_ids": [],
        "confidence": 1.0,
        "human_approval_required": True,
        "acknowledgement_required": True,
    }


def mock_plan(version: int = 1) -> dict:
    return {
        "plan_id": f"plan-v{version}",
        "incident_id": "wildfire-demo-01",
        "version": version,
        "summary": "Withdraw Alpha 3 to refill via North Access",
        "objectives": ["protect crews", "maintain suppression"],
        "unit_actions": [
            {"unit_id": "alpha-3", "action_type": "withdraw", "target": "water-point-2"}
        ],
        "created_at": "2026-07-25T10:00:00Z",
    }


def dispatch_body(plan_id: str) -> dict:
    return {
        "instructions": [
            {
                "dispatch_id": "dsp-1",
                "plan_id": plan_id,
                "unit_id": "alpha-3",
                "priority": "high",
                "message_text": "Alpha 3, repli vers le point d'eau 2.",
                "acknowledgement_required": True,
                "generated_at": "2026-07-25T10:00:00Z",
                "dispatch_status": "pending",
            }
        ]
    }


def make_client() -> TestClient:
    return TestClient(create_app())


def test_dispatch_hard_fails_before_approval():
    client = make_client()
    client.post("/plans", json=mock_plan())
    resp = client.post("/dispatch/send", json=dispatch_body("plan-v1"))
    assert resp.status_code == 403
    assert "dispatch locked" in resp.json()["detail"]


def test_dispatch_unlocked_after_approve_decision():
    client = make_client()
    client.post("/plans", json=mock_plan())
    decision = client.post(
        "/approval/decision",
        json={
            "plan_id": "plan-v1",
            "decision": "approve",
            "operator_name": "Incident Commander (demo)",
            "operator_note": "Approved as proposed.",
        },
    )
    assert decision.status_code == 200
    resp = client.post("/dispatch/send", json=dispatch_body("plan-v1"))
    assert resp.status_code == 200


def test_modify_creates_next_version_and_keeps_history():
    client = make_client()
    client.post("/plans", json=mock_plan())
    new_actions = [unit_action("alpha-3", "hold")]
    resp = client.post(
        "/approval/decision",
        json={
            "plan_id": "plan-v1",
            "decision": "modify",
            "operator_name": "Incident Commander (demo)",
            "operator_note": "Hold instead of withdraw.",
            "modified_actions": new_actions,
        },
    )
    assert resp.status_code == 200
    new_plan = resp.json()["new_plan"]
    assert new_plan["plan_id"] == "plan-v2"
    assert new_plan["version"] == 2
    assert new_plan["unit_actions"] == new_actions
    # version N still retrievable, untouched
    v1 = client.get("/plans/plan-v1").json()
    assert v1["version"] == 1
    assert v1["unit_actions"][0]["action_type"] == "withdraw"
    # modification alone does NOT unlock dispatch
    assert client.post("/dispatch/send", json=dispatch_body("plan-v2")).status_code == 403


def test_decisions_audited_as_contract_valid_approval_decisions():
    client = make_client()
    client.post("/plans", json=mock_plan())
    client.post(
        "/approval/decision",
        json={
            "plan_id": "plan-v1",
            "decision": "modify",
            "operator_name": "IC",
            "modified_actions": [unit_action("bravo-2", "hold")],
        },
    )
    client.post(
        "/approval/decision",
        json={"plan_id": "plan-v2", "decision": "approve", "operator_name": "IC"},
    )
    audit = client.get("/plans").json()["decisions"]
    assert len(audit) == 2
    for record in audit:
        DECISION_VALIDATOR.validate(record)
    # events emitted for the workflow
    # (approval.received twice, plan.revision.requested + plan.draft.ready for the new version)


def test_reject_recorded_and_dispatch_stays_locked():
    client = make_client()
    client.post("/plans", json=mock_plan())
    resp = client.post(
        "/approval/decision",
        json={
            "plan_id": "plan-v1",
            "decision": "reject",
            "operator_name": "IC",
            "operator_note": "Too risky near the hangar.",
        },
    )
    assert resp.status_code == 200
    assert client.post("/dispatch/send", json=dispatch_body("plan-v1")).status_code == 403


def test_reset_clears_plans_and_decisions():
    client = make_client()
    client.post("/plans", json=mock_plan())
    client.post(
        "/approval/decision",
        json={"plan_id": "plan-v1", "decision": "approve", "operator_name": "IC"},
    )
    client.post("/incident/reset")
    assert client.get("/plans").json() == {
        "plans": [],
        "approved_plan_id": None,
        "decisions": [],
    }
    assert client.post("/dispatch/send", json=dispatch_body("plan-v1")).status_code == 403
