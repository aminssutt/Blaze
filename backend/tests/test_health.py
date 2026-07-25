"""/health must answer 200 with the full structure even when everything is down."""

import pytest
from fastapi.testclient import TestClient

from api.config import Settings, get_settings
from api.main import create_app


@pytest.fixture()
def client(monkeypatch):
    """App wired to an unreachable vLLM so the sub-check fails fast."""
    get_settings.cache_clear()
    monkeypatch.setenv("VLLM_BASE_URL", "http://127.0.0.1:1")  # nothing listens here
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
    get_settings.cache_clear()


def test_health_returns_200_even_when_everything_is_down(client):
    response = client.get("/health")
    assert response.status_code == 200


def test_health_payload_structure(client):
    payload = client.get("/health").json()

    assert payload["status"] in ("ok", "degraded")
    assert "demo_mode" in payload
    assert "network_mode" in payload

    checks = payload["checks"]
    assert set(checks) == {"vllm", "stt", "tts"}
    for component in checks.values():
        assert "status" in component


def test_health_vllm_unreachable_is_reported_not_fatal(client):
    payload = client.get("/health").json()
    assert payload["checks"]["vllm"]["status"] == "unreachable"
    assert payload["status"] == "degraded"


def test_health_stt_tts_statuses_are_valid(client):
    checks = client.get("/health").json()["checks"]
    assert checks["stt"]["status"] in ("ok", "not_installed")
    assert checks["tts"]["status"] in ("ok", "not_installed")


def test_settings_defaults_match_env_example():
    settings = Settings(_env_file=None)
    assert settings.backend_port == 8080
    assert settings.frontend_port == 3000
    assert settings.vllm_base_url == "http://localhost:8000"
    assert "http://localhost:3000" in settings.cors_origins
