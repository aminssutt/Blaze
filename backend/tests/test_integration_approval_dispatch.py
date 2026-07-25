"""Integration 4 (issue #55) — approval gate + dispatch constraints + per-unit
TTS, end to end at the API level with the REAL Piper voice.

The live-agent leg (Dispatch Agent invents nothing, Gemma on the L40S VM) was
validated by integration #52's two green E2E runs; this suite locks the
platform guarantees those runs rely on.
"""

import wave

import pytest
from fastapi.testclient import TestClient

import backend.api.routers.dispatch as dispatch_module
from backend.api.config import REPO_ROOT
from backend.api.main import create_app


def unit_action(unit_id: str, action_type: str, instruction: str) -> dict:
    return {
        "action_id": f"ua-{unit_id}-{action_type}",
        "unit_id": unit_id,
        "action_type": action_type,
        "instruction": instruction,
        "reason": "integration test",
        "priority": "critical",
        "evidence_ids": [],
        "confidence": 0.9,
        "human_approval_required": True,
        "acknowledgement_required": True,
    }


V1_ACTIONS = [
    unit_action("alpha-3", "attack", "Alpha 3, poursuivez l'attaque du front nord."),
    unit_action("bravo-2", "recon", "Bravo 2, reconnaissance rapprochée du hangar."),
    unit_action("charlie-1", "hold", "Charlie 1, maintenez la position sur la D17."),
]
V2_ACTIONS = [
    unit_action("alpha-3", "withdraw", "Alpha 3, repli immédiat vers le point d'eau 2."),
    unit_action("bravo-2", "hold", "Bravo 2, restez hors du périmètre d'exclusion du hangar."),
    unit_action("charlie-1", "confirm_route", "Charlie 1, confirmez l'accès D17 véhicules légers."),
]


def plan_v1() -> dict:
    return {
        "plan_id": "plan-v1",
        "incident_id": "wildfire-demo-01",
        "version": 1,
        "summary": "Initial suppression plan",
        "objectives": ["suppress"],
        "unit_actions": V1_ACTIONS,
        "created_at": "2026-07-25T10:00:00Z",
    }


def instructions_from(plan: dict) -> list[dict]:
    return [
        {
            "dispatch_id": f"dsp-{action['unit_id']}",
            "plan_id": plan["plan_id"],
            "unit_id": action["unit_id"],
            "priority": action["priority"],
            "message_text": action["instruction"],
            "acknowledgement_required": action["acknowledgement_required"],
            "generated_at": "2026-07-25T10:00:00Z",
            "dispatch_status": "pending",
        }
        for action in plan["unit_actions"]
    ]


@pytest.fixture
def client():
    dispatch_module._tts_service = None  # real voice from .env
    app = create_app()
    with TestClient(app) as c:
        yield c, app


def test_full_approval_to_dispatch_chain(client):
    c, app = client

    # -- 1. dispatch before ANY approval: rejected end to end ---------------
    c.post("/plans", json=plan_v1())
    refused = c.post(
        "/dispatch/send", json={"instructions": instructions_from(plan_v1())}
    )
    assert refused.status_code == 403
    types = [e["event_type"] for e in app.state.event_bus.history]
    assert "tts.started" not in types and "dispatch.sent" not in types

    # -- 2. modify -> v2; v1 stays dispatch-locked --------------------------
    modified = c.post(
        "/approval/decision",
        json={
            "plan_id": "plan-v1",
            "decision": "modify",
            "operator_name": "Incident Commander",
            "operator_note": "Repli plutôt qu'attaque.",
            "modified_actions": V2_ACTIONS,
        },
    ).json()
    plan_v2 = modified["new_plan"]
    assert plan_v2["version"] == 2 and plan_v2["unit_actions"] == V2_ACTIONS
    assert c.get("/plans/plan-v1").json()["unit_actions"] == V1_ACTIONS  # history kept
    still_locked = c.post(
        "/dispatch/send", json={"instructions": instructions_from(plan_v1())}
    )
    assert still_locked.status_code == 403

    # -- 3. approve v2; dispatch carries v2 content ONLY --------------------
    c.post(
        "/approval/decision",
        json={"plan_id": "plan-v2", "decision": "approve", "operator_name": "IC"},
    )
    sent = c.post(
        "/dispatch/send", json={"instructions": instructions_from(plan_v2)}
    )
    assert sent.status_code == 200
    results = sent.json()["results"]
    assert len(results) == 3
    v2_texts = {a["instruction"] for a in V2_ACTIONS}
    v1_texts = {a["instruction"] for a in V1_ACTIONS}
    for result in results:
        instruction = result["instruction"]
        assert instruction["plan_id"] == "plan-v2"
        assert instruction["message_text"] in v2_texts
        assert instruction["message_text"] not in v1_texts

    # v1 instructions remain rejected even now (only v2 is approved)
    assert (
        c.post("/dispatch/send", json={"instructions": instructions_from(plan_v1())})
        .status_code
        == 403
    )

    # -- 4. three units -> three REAL playable WAVs, served over HTTP -------
    for result in results:
        assert result["tts"]["status"] == "success", result["tts"]
        with wave.open(str(REPO_ROOT / result["tts"]["wav_path"])) as f:
            assert f.getnframes() > 0
    for unit in ("alpha-3", "bravo-2", "charlie-1"):
        audio = c.get(f"/dispatch/audio/{unit}")
        assert audio.status_code == 200
        assert audio.headers["content-type"] == "audio/wav"
        assert len(audio.content) > 10_000

    # events: 3x instruction.ready (feeds the UI cards) + 3x tts.ready +
    # 3x dispatch.sent, all simulated
    history = app.state.event_bus.history
    assert (
        sum(e["event_type"] == "dispatch.instruction.ready" for e in history) == 3
    )
    assert sum(e["event_type"] == "tts.ready" for e in history) == 3
    sent_events = [e for e in history if e["event_type"] == "dispatch.sent"]
    assert len(sent_events) == 3
    assert all(e["payload"]["delivery"] == "simulated_dispatch" for e in sent_events)
