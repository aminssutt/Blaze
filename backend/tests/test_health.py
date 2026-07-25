"""/health must answer 200 with the full structure even when everything is down."""

import pytest
from fastapi.testclient import TestClient

from backend.api.config import Settings, get_settings
from backend.api.main import create_app


def test_health_returns_component_statuses():
    client = TestClient(create_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in ("ok", "degraded")
    assert set(body["components"]) == {"vllm", "stt", "tts"}
    for component in body["components"].values():
        assert "status" in component and "detail" in component


def test_config_comes_from_env():
    settings = get_settings()
    # .env.example defaults — no hardcoded ports in app code
    assert settings.backend_port == 8080
    assert settings.scenario_id == "wildfire-demo-01"


@pytest.fixture()
def client_all_down(monkeypatch):
    """App wired to an unreachable vLLM so every sub-check can fail."""
    get_settings.cache_clear()
    monkeypatch.setenv("VLLM_BASE_URL", "http://127.0.0.1:1")  # nothing listens here
    with TestClient(create_app()) as client:
        yield client
    get_settings.cache_clear()


def test_health_returns_200_even_when_everything_is_down(client_all_down):
    resp = client_all_down.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["components"]["vllm"]["status"] == "unreachable"
    assert "vllm" in body["degraded_components"]


def test_health_stt_tts_statuses_are_non_fatal(client_all_down):
    components = client_all_down.get("/health").json()["components"]
    assert components["stt"]["status"] in ("ok", "not_installed")
    assert components["tts"]["status"] in ("ok", "not_installed", "not_configured", "missing")


def test_settings_defaults_match_env_example():
    settings = Settings(_env_file=None)
    assert settings.backend_port == 8080
    assert settings.frontend_port == 3000
    assert settings.vllm_base_url == "http://localhost:8000"
    assert "http://localhost:3000" in settings.cors_origins
