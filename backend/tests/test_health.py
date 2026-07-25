from fastapi.testclient import TestClient

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
    from backend.api.config import get_settings

    settings = get_settings()
    # .env.example defaults — no hardcoded ports in app code
    assert settings.backend_port == 8080
    assert settings.scenario_id == "wildfire-demo-01"
