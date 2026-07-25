import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from tools.firms import adapter

REPO_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft7Validator(
    json.loads(
        (REPO_ROOT / "contracts" / "schemas" / "tool_result.schema.json").read_text()
    )
)

SAMPLE_CSV = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,"
    "instrument,confidence,version,bright_ti5,frp,daynight\n"
    "43.48272,3.64761,340.92,0.39,0.59,2026-07-24,1153,N,VIIRS,n,2.0NRT,308.46,6.79,D\n"
    "43.44343,4.88134,309.61,0.49,0.4,2026-07-24,211,N,VIIRS,n,2.0NRT,295.27,1.2,N\n"
)


def test_normalize_parses_csv_into_contract_valid_toolresult():
    result = adapter.normalize(SAMPLE_CSV)
    VALIDATOR.validate(result)
    assert result["source_type"] == "live_public"
    assert result["data"]["hotspot_count"] == 2
    first = result["data"]["hotspots"][0]
    assert first["latitude"] == 43.48272
    assert first["frp_mw"] == 6.79
    assert result["data_timestamp"] == "2026-07-24T11:53:00+00:00"


def test_committed_cache_served_as_cached_public():
    result = adapter.fetch_cached()
    VALIDATOR.validate(result)
    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True
    assert result["staleness_seconds"] is not None


def test_live_failure_falls_back_to_cache_and_signals(monkeypatch):
    monkeypatch.setattr(
        adapter, "fetch_live", lambda **kw: (_ for _ in ()).throw(RuntimeError("down"))
    )
    signals = []
    result = adapter.get(mode="live", on_fallback=signals.append)
    VALIDATOR.validate(result)
    assert result["status"] == "fallback"
    assert result["source_type"] == "cached_public"
    assert "down" in result["error"]
    assert signals and signals[0]["fallback"] == "firms_cache"


def test_missing_key_falls_back_without_crash(monkeypatch, tmp_path):
    monkeypatch.setattr(adapter, "_map_key", lambda: None)
    result = adapter.get(mode="live")
    assert result["status"] == "fallback"
    assert "MAP_KEY missing" in result["error"]


def test_total_failure_returns_empty_error_result_not_crash(monkeypatch, tmp_path):
    monkeypatch.setattr(adapter, "_map_key", lambda: None)
    result = adapter.get(mode="live", cache_path=tmp_path / "missing.json")
    VALIDATOR.validate(result)
    assert result["status"] == "error"
    assert result["data"]["hotspots"] == []


def test_offline_env_serves_cache(monkeypatch):
    monkeypatch.setenv("NETWORK_MODE", "offline")
    result = adapter.get()
    assert result["source_type"] == "cached_public"
