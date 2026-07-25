"""Integration 4 (#55): approval gate + dispatch constraints + per-unit TTS, E2E.

Drives the real HTTP API end to end: a draft plan is submitted, dispatch is
attempted before any decision (must be locked), the modify flow mints v2, only
an explicit approve unlocks dispatch, and the real Piper voice produces one
playable WAV per unit.
"""

import os
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]
VOICE = REPO_ROOT / "speech" / "tts" / "piper-voices" / "fr_FR-siwis-medium.onnx"
UNITS = ["alpha-3", "bravo-2", "charlie-1"]

os.environ.setdefault("PIPER_VOICE_PATH", str(VOICE))


def make_plan(plan_id: str, version: int = 1) -> dict:
    return {
        "plan_id": plan_id,
        "incident_id": "wildfire-demo-01",
        "version": version,
        "summary": "Retreat and containment around the hangar zone",
        "objectives": ["protect units", "contain the eastern front"],
        "unit_actions": [
            {
                "action_id": f"{plan_id}-a1",
                "unit_id": "alpha-3",
                "action_type": "retreat",
                "instruction": "Repli immédiat via North Access vers Water Point 2, D17 interdite aux CCF",
                "route": "north-access",
                "destination": "water-point-2",
                "reason": "eau à 30% et visibilité quasi nulle",
                "priority": "critical",
                "evidence_ids": [],
                "confidence": 0.9,
                "human_approval_required": True,
                "acknowledgement_required": True,
            },
            {
                "action_id": f"{plan_id}-a2",
                "unit_id": "bravo-2",
                "action_type": "monitor",
                "instruction": "Reconnaissance distante, rester hors du périmètre d'exclusion",
                "route": None,
                "destination": None,
                "reason": "explosions confirmées près du hangar",
                "priority": "high",
                "evidence_ids": [],
                "confidence": 0.85,
                "human_approval_required": True,
                "acknowledgement_required": True,
            },
            {
                "action_id": f"{plan_id}-a3",
                "unit_id": "charlie-1",
                "action_type": "confirm_access",
                "instruction": "Confirmer l'accès D17 pour véhicules légers",
                "route": "d17",
                "destination": None,
                "reason": "correction reçue: D17 ouverte aux véhicules légers",
                "priority": "medium",
                "evidence_ids": [],
                "confidence": 0.8,
                "human_approval_required": False,
                "acknowledgement_required": False,
            },
        ],
        "created_at": "2026-07-25T10:00:00Z",
    }


def make_instruction(plan_id: str, unit_id: str, text: str) -> dict:
    return {
        "dispatch_id": f"disp-{plan_id}-{unit_id}",
        "plan_id": plan_id,
        "unit_id": unit_id,
        "priority": "high",
        "message_text": text,
        "acknowledgement_required": True,
        "generated_at": "2026-07-25T10:05:00Z",
    }


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/incident/reset")
        yield c
        c.post("/incident/reset")


def test_dispatch_before_any_decision_is_locked(client):
    plan = make_plan("plan-55-gate")
    assert client.post("/plans", json=plan).status_code == 200

    body = {"instructions": [make_instruction("plan-55-gate", u, "test") for u in UNITS]}
    resp = client.post("/dispatch/send", json=body)
    assert resp.status_code == 403
    assert "dispatch locked" in resp.json()["detail"]
    # Nothing left the gate: no tts/dispatch event reached the stream.
    history = client.app.state.event_bus.history
    assert not [e for e in history if e["event_type"].startswith(("tts.", "dispatch."))]


def test_modify_mints_v2_and_only_v2_approval_unlocks_dispatch(client):
    plan = make_plan("plan-55-mod")
    assert client.post("/plans", json=plan).status_code == 200

    modified = make_plan("plan-55-mod")["unit_actions"]
    modified[0]["instruction"] = "Repli IMMÉDIAT via North Access vers Water Point 2"
    resp = client.post(
        "/approval/decision",
        json={
            "plan_id": "plan-55-mod",
            "decision": "modify",
            "operator_name": "commandant test",
            "operator_note": "repli immédiat",
            "modified_actions": modified,
        },
    )
    assert resp.status_code == 200
    v2 = resp.json()["new_plan"]
    assert v2 is not None and v2["version"] == 2 and v2["plan_id"] != "plan-55-mod"
    assert v2["unit_actions"][0]["instruction"].startswith("Repli IMMÉDIAT")

    # modify is NOT an authorization: both versions still locked.
    for pid in ("plan-55-mod", v2["plan_id"]):
        resp = client.post(
            "/dispatch/send", json={"instructions": [make_instruction(pid, "alpha-3", "x")]}
        )
        assert resp.status_code == 403, f"{pid} must stay locked after modify"

    # Approve v2: v2 unlocks, v1 stays locked (dispatch uses v2 only).
    resp = client.post(
        "/approval/decision",
        json={
            "plan_id": v2["plan_id"],
            "decision": "approve",
            "operator_name": "commandant test",
        },
    )
    assert resp.status_code == 200
    assert (
        client.post(
            "/dispatch/send",
            json={"instructions": [make_instruction("plan-55-mod", "alpha-3", "x")]},
        ).status_code
        == 403
    )
    resp = client.post(
        "/dispatch/send",
        json={"instructions": [make_instruction(v2["plan_id"], "alpha-3", "Repli immédiat")]},
    )
    assert resp.status_code == 200


@pytest.mark.skipif(not VOICE.is_file(), reason="Piper voice model not present")
def test_three_units_three_playable_wavs_through_the_real_path(client):
    plan = make_plan("plan-55-tts")
    assert client.post("/plans", json=plan).status_code == 200
    assert (
        client.post(
            "/approval/decision",
            json={
                "plan_id": "plan-55-tts",
                "decision": "approve",
                "operator_name": "commandant test",
            },
        ).status_code
        == 200
    )

    messages = {
        "alpha-3": "Alpha 3, repli immédiat via North Access vers Water Point 2. La D17 est interdite aux camions-citernes.",
        "bravo-2": "Bravo 2, reconnaissance distante uniquement. Restez hors du périmètre d'exclusion.",
        "charlie-1": "Charlie 1, confirmez l'accès D17 pour les véhicules légers.",
    }
    body = {
        "instructions": [
            make_instruction("plan-55-tts", u, t) for u, t in messages.items()
        ]
    }
    resp = client.post("/dispatch/send", json=body)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["delivery"] == "simulated_dispatch"
    assert len(payload["results"]) == 3
    for result in payload["results"]:
        assert result["tts"]["status"] == "success", result["tts"].get("error")

    # The three WAVs are real audio and served to the UI.
    for unit in UNITS:
        resp = client.get(f"/dispatch/audio/{unit}")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("audio/wav")
        assert resp.content[:4] == b"RIFF"
        wav_path = REPO_ROOT / "speech" / "tts" / "output" / f"dispatch_{unit}.wav"
        with wave.open(str(wav_path)) as wav:
            duration_s = wav.getnframes() / wav.getframerate()
        assert duration_s > 1.0, f"{unit} WAV suspiciously short: {duration_s:.2f}s"

    # Full audit trail on the stream: started -> ready -> sent, per unit.
    history = client.app.state.event_bus.history
    for etype in ("tts.started", "tts.ready", "dispatch.sent"):
        assert len([e for e in history if e["event_type"] == etype]) == 3
