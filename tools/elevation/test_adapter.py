"""Tests for the Open-Meteo elevation adapter (issue #28).

Run from the repo root:  python -m pytest tools/elevation -v
"""

import importlib.util
import json
import math
from pathlib import Path

import pytest
import requests

_spec = importlib.util.spec_from_file_location(
    "elevation_adapter", Path(__file__).resolve().parent / "adapter.py"
)
adapter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(adapter)

POINTS = adapter._demo_points(adapter.DEMO_LAT, adapter.DEMO_LON)
# center, north, south, east, west
SAMPLE_RAW = {"elevation": [50.0, 60.0, 40.0, 55.0, 45.0]}

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
    cache = tmp_path / "openmeteo_elevation_demo.json"
    result = adapter.normalize(SAMPLE_RAW, POINTS, retrieved_at="2026-07-24T10:00:05+00:00")
    cache.write_text(json.dumps(result), encoding="utf-8")
    return cache


def test_normalize_returns_five_points_and_slope():
    result = adapter.normalize(SAMPLE_RAW, POINTS, retrieved_at="2026-07-24T10:00:05+00:00")

    for field in REQUIRED_FIELDS:
        assert field in result, f"missing required ToolResult field: {field}"
    assert result["tool_name"] == "elevation"
    assert result["status"] == "success"
    assert result["source_type"] == "live_public"
    assert result["source_name"] == "open-meteo-elevation"
    assert result["is_cached"] is False

    data = result["data"]
    assert len(data["points"]) == 5
    ids = [p["id"] for p in data["points"]]
    assert ids == ["center", "north", "south", "east", "west"]
    assert data["points"][0]["elevation_m"] == 50.0

    slope = data["slope"]
    # Terrain rises 20 m northward over ~1002 m and 10 m eastward over ~1002 m.
    assert slope["slope_north_pct"] == pytest.approx(2.0, rel=0.02)
    assert slope["slope_east_pct"] == pytest.approx(1.0, rel=0.02)
    assert slope["slope_pct"] == pytest.approx(math.hypot(2.0, 1.0), rel=0.02)
    # Downhill points opposite the ascent direction (ascent ~26.6 deg, downhill ~206.6 deg).
    assert slope["downhill_azimuth_deg"] == pytest.approx(206.6, abs=0.5)


def test_normalize_rejects_count_mismatch():
    with pytest.raises(ValueError):
        adapter.normalize({"elevation": [1.0, 2.0]}, POINTS)


def test_flat_terrain_has_no_downhill_direction():
    result = adapter.normalize({"elevation": [10.0] * 5}, POINTS)
    slope = result["data"]["slope"]
    assert slope["slope_pct"] == 0.0
    assert slope["downhill_azimuth_deg"] is None


def test_fetch_cached_sets_cached_provenance_and_staleness(tmp_path):
    cache = _write_cache(tmp_path)

    result = adapter.fetch_cached(cache_path=cache)

    assert result["status"] == "success"
    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True
    assert result["staleness_seconds"] is not None
    assert result["staleness_seconds"] > 0
    assert len(result["data"]["points"]) == 5


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
    assert len(result["data"]["points"]) == 5
    assert result["data"]["slope"]["slope_pct"] is not None

