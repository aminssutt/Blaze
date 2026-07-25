"""Offline mode E2E (issue #36): with the network booby-trapped, every adapter
serves correctly-labeled cached/seeded data and a full scenario run completes."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.api.main import create_app


@pytest.fixture
def no_network(monkeypatch):
    """Any outbound HTTP attempt fails the test immediately."""

    def boom(*args, **kwargs):
        raise AssertionError(f"outbound network attempt in offline mode! {args[:1]}")

    monkeypatch.setattr("urllib.request.urlopen", boom)
    monkeypatch.setattr("requests.get", boom)
    monkeypatch.setattr("requests.post", boom)
    monkeypatch.setattr("requests.request", boom)
    monkeypatch.setenv("NETWORK_MODE", "offline")


def test_toggle_offline_propagates_to_adapter_env(monkeypatch):
    monkeypatch.setenv("NETWORK_MODE", "online")
    client = TestClient(create_app())
    resp = client.post("/incident/network-mode", json={"network_mode": "offline"})
    assert resp.json()["network_mode"] == "offline"
    import os

    assert os.environ["NETWORK_MODE"] == "offline"


def test_every_adapter_serves_labeled_cache_offline(no_network):
    from tools import cadastre, firms, osm
    from tools.elevation import adapter as elevation
    from tools.weather import adapter as weather
    from tools.resources import get_store

    for name, result in {
        "weather": weather.get(),
        "elevation": elevation.get(),
        "firms": firms.get(),
        "osm": osm.get(),
        "cadastre": cadastre.get(),
    }.items():
        assert result["status"] == "success", f"{name}: {result.get('error')}"
        assert result["source_type"] == "cached_public", name

    seeded = get_store().get("units")
    assert seeded["source_type"] == "seeded_demo"


def test_all_five_audios_ingest_offline(no_network):
    """Integration #56: the real audio ingestion path is file-only — all five
    manifest audios flow with the network booby-trapped."""
    import asyncio

    from backend.loaders.audio_ingestion import AudioIngestionService
    from backend.streaming.bus import EventBus

    bus = EventBus("wildfire-demo-01")
    counts = asyncio.run(
        AudioIngestionService().ingest(bus, variant="radio", speed_factor=0)
    )
    assert counts == {"emitted": 5, "errors": 0}
    received = [e for e in bus.history if e["event_type"] == "audio.received"]
    assert [e["payload"]["audio_id"] for e in received] == [
        "audio_01", "audio_02", "audio_03", "audio_04", "audio_05",
    ]


def test_full_scenario_run_completes_offline(no_network):
    client = TestClient(create_app())
    client.post("/incident/reset")
    resp = client.post(
        "/incident/start", json={"audio_variant": "radio", "speed_factor": 0}
    )
    assert resp.status_code == 200
    for _ in range(100):
        status = client.get("/incident/status").json()
        if status["state"] == "COMPLETED":
            break
        import time

        time.sleep(0.05)
    assert status["state"] == "COMPLETED"
    assert status["last_sequence"] == 70
    assert status["network_mode"] == "offline"
