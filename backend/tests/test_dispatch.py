import wave
from pathlib import Path

from fastapi.testclient import TestClient

import backend.api.routers.dispatch as dispatch_module
from backend.api.config import REPO_ROOT
from backend.api.main import create_app
from speech.tts.service import TTSService


def make_instruction(unit_id: str, text: str) -> dict:
    return {
        "dispatch_id": f"dsp-{unit_id}",
        "plan_id": "plan-v1",
        "unit_id": unit_id,
        "priority": "high",
        "message_text": text,
        "acknowledgement_required": True,
        "generated_at": "2026-07-25T10:00:00Z",
        "dispatch_status": "pending",
    }


MESSAGES = {
    "alpha-3": "Alpha 3, repli immédiat vers le point d'eau numéro 2.",
    "bravo-2": "Bravo 2, maintenez la distance de sécurité derrière le hangar.",
    "charlie-1": "Charlie 1, confirmez l'état de la D17 pour véhicules légers.",
}


def test_three_unit_messages_produce_three_playable_wavs(tmp_path):
    dispatch_module._tts_service = None  # fresh service with real voice from .env
    app = create_app()
    client = TestClient(app)
    body = {"instructions": [make_instruction(u, t) for u, t in MESSAGES.items()]}
    resp = client.post("/dispatch/send", json=body)
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["delivery"] == "simulated_dispatch"
    assert len(payload["results"]) == 3
    for result in payload["results"]:
        assert result["tts"]["status"] == "success"
        assert result["tts"]["latency_ms"] > 0  # latency recorded
        wav_path = REPO_ROOT / result["tts"]["wav_path"]
        with wave.open(str(wav_path)) as f:  # playable WAV
            assert f.getnframes() > 0
    # audio endpoint serves the generated file
    audio = client.get("/dispatch/audio/alpha-3")
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"
    # events emitted: tts.started/tts.ready/dispatch.sent per unit
    types = [e["event_type"] for e in app.state.event_bus.history]
    assert types.count("tts.ready") == 3
    assert types.count("dispatch.sent") == 3


def test_tts_failure_falls_back_to_text_without_crash(tmp_path):
    dispatch_module._tts_service = TTSService(voice_path="/nonexistent/voice.onnx")
    try:
        app = create_app()
        client = TestClient(app)
        body = {"instructions": [make_instruction("alpha-3", MESSAGES["alpha-3"])]}
        resp = client.post("/dispatch/send", json=body)
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["tts"]["status"] == "fallback"
        assert result["tts"]["fallback_text"] == MESSAGES["alpha-3"]
        assert result["instruction"]["tts_audio_path"] is None
        types = [e["event_type"] for e in app.state.event_bus.history]
        assert "fallback.activated" in types
        assert "dispatch.sent" in types  # text still dispatched (simulated)
    finally:
        dispatch_module._tts_service = None


def test_dispatch_clearly_labeled_simulated():
    dispatch_module._tts_service = None
    app = create_app()
    client = TestClient(app)
    body = {"instructions": [make_instruction("bravo-2", MESSAGES["bravo-2"])]}
    payload = client.post("/dispatch/send", json=body).json()
    assert payload["delivery"] == "simulated_dispatch"
    assert payload["results"][0]["delivery"] == "simulated_dispatch"
    sent = [
        e for e in app.state.event_bus.history if e["event_type"] == "dispatch.sent"
    ]
    assert all(e["payload"]["delivery"] == "simulated_dispatch" for e in sent)
