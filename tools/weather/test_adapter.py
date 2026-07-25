"""Tests for the Open-Meteo weather adapter (issue #27).

Run from the repo root:  python -m pytest tools/weather -v
"""

import importlib.util
import json
from pathlib import Path

import pytest
import requests

_spec = importlib.util.spec_from_file_location(
    "weather_adapter", Path(__file__).resolve().parent / "adapter.py"
)
adapter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(adapter)

SAMPLE_RAW = {
    "latitude": 43.45,
    "longitude": 3.75,
    "elevation": 12.0,
    "timezone": "UTC",
    "current_units": {
        "time": "iso8601",
        "temperature_2m": "°C",
        "relative_humidity_2m": "%",
        "wind_speed_10m": "km/h",
        "wind_direction_10m": "°",
        "wind_gusts_10m": "km/h",
        "precipitation": "mm",
    },
    "current": {
        "time": "2026-07-24T10:00",
        "temperature_2m": 28.4,
        "relative_humidity_2m": 42,
        "wind_speed_10m": 21.6,
        "wind_direction_10m": 315,
        "wind_gusts_10m": 38.9,
        "precipitation": 0.0,
    },
}

REQUIRED_FIELDS = [
    "tool_call_id",
    "tool_name",
    "status",
    "source_type",
    "source_name",
    "retrieved_at",
    "is_cached",
]


def _write_cache(tmp_path):
    cache = tmp_path / "openmeteo_weather_demo.json"
    result = adapter.normalize(SAMPLE_RAW, retrieved_at="2026-07-24T10:00:05+00:00")
    cache.write_text(json.dumps(result), encoding="utf-8")
    return cache


def test_normalize_maps_all_weather_fields():
    result = adapter.normalize(SAMPLE_RAW, retrieved_at="2026-07-24T10:00:05+00:00")

    for field in REQUIRED_FIELDS:
        assert field in result, f"missing required ToolResult field: {field}"
    assert result["tool_name"] == "weather"
    assert result["status"] == "success"
    assert result["source_type"] == "live_public"
    assert result["source_name"] == "open-meteo"
    assert result["is_cached"] is False
    assert result["error"] is None
    assert result["data_timestamp"] == "2026-07-24T10:00:00+00:00"

    data = result["data"]
    assert data["temperature_c"] == 28.4
    assert data["relative_humidity_pct"] == 42
    assert data["wind_speed_kmh"] == 21.6
    assert data["wind_direction_deg"] == 315
    assert data["wind_gusts_kmh"] == 38.9
    assert data["precipitation_mm"] == 0.0
    assert data["units"]["wind_speed"] == "km/h"


def test_fetch_cached_sets_cached_provenance_and_staleness(tmp_path):
    cache = _write_cache(tmp_path)

    result = adapter.fetch_cached(cache_path=cache)

    assert result["status"] == "success"
    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True
    assert result["staleness_seconds"] is not None
    assert result["staleness_seconds"] > 0
    assert result["data"]["wind_speed_kmh"] == 21.6


def test_get_live_falls_back_to_cache_on_network_error(tmp_path, monkeypatch):
    cache = _write_cache(tmp_path)

    def boom(*args, **kwargs):
        raise requests.ConnectionError("network down")

    monkeypatch.setattr(adapter.requests, "get", boom)

    result = adapter.get(mode="live", cache_path=cache)

    assert result["status"] == "fallback"
    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True
    assert "network down" in result["error"]
    assert result["data"]["temperature_c"] == 28.4


def test_get_offline_env_serves_cache(tmp_path, monkeypatch):
    cache = _write_cache(tmp_path)
    monkeypatch.setenv("NETWORK_MODE", "offline")
    monkeypatch.setenv("USE_CACHED_EXTERNAL_DATA", "false")

    def no_network(*args, **kwargs):  # must never be called
        raise AssertionError("live API called in offline mode")

    monkeypatch.setattr(adapter.requests, "get", no_network)

    result = adapter.get(cache_path=cache)

    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True


def test_get_returns_error_when_no_cache(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise requests.Timeout("timed out")

    monkeypatch.setattr(adapter.requests, "get", boom)

    result = adapter.get(mode="live", cache_path=tmp_path / "missing.json")

    assert result["status"] == "error"
    assert result["data"] is None
    assert "timed out" in result["error"]


def test_committed_demo_cache_is_valid():
    if not adapter.CACHE_PATH.exists():
        pytest.skip("demo cache not generated yet")
    result = adapter.fetch_cached()
    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True
    assert result["staleness_seconds"] >= 0
    assert result["data"]["wind_speed_kmh"] is not None

