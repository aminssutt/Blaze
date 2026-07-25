import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from tools.osm import loader

REPO_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft7Validator(
    json.loads(
        (REPO_ROOT / "contracts" / "schemas" / "tool_result.schema.json").read_text()
    )
)


def test_cached_geojson_served_as_contract_valid_toolresult():
    result = loader.get()
    VALIDATOR.validate(result)
    assert result["status"] == "success"
    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True
    assert result["data"]["feature_count"] > 500


def test_demo_relevant_categories_present():
    counts = loader.get()["data"]["category_counts"]
    for category in ("road", "track", "water_point", "industrial", "critical_asset"):
        assert counts.get(category, 0) > 0, f"missing {category}"


def test_category_filter():
    result = loader.get(category="water_point")
    assert result["data"]["feature_count"] > 50
    assert all(
        f["properties"]["category"] == "water_point"
        for f in result["data"]["features"]
    )


def test_never_calls_overpass_when_cached_flag_set(monkeypatch):
    monkeypatch.setenv("USE_CACHED_EXTERNAL_DATA", "true")
    with pytest.raises(RuntimeError, match="refresh refused"):
        loader.get(mode="refresh")
    # and the normal path performs no network access at all (pure file read)
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("network call!")),
    )
    assert loader.get()["status"] == "success"


def test_missing_cache_returns_error_result_not_crash(tmp_path):
    result = loader.get(data_path=tmp_path / "missing.geojson")
    VALIDATOR.validate(result)
    assert result["status"] == "error"
    assert result["data"]["features"] == []
