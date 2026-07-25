import json
from pathlib import Path

from jsonschema import Draft7Validator

from tools.cadastre import loader

REPO_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = Draft7Validator(
    json.loads(
        (REPO_ROOT / "contracts" / "schemas" / "tool_result.schema.json").read_text()
    )
)

HANGAR_ZONE = (3.751, 43.450, 3.761, 43.460)  # ~500 m around 43.455, 3.756


def test_committed_geojson_served_as_cached_public_toolresult():
    result = loader.get()
    VALIDATOR.validate(result)
    assert result["status"] == "success"
    assert result["source_type"] == "cached_public"
    assert result["is_cached"] is True
    assert result["data"]["building_count"] > 5000


def test_hangar_zone_covered():
    result = loader.get(bbox=HANGAR_ZONE)
    assert result["data"]["building_count"] > 100


def test_no_owner_or_property_fields():
    result = loader.get()
    forbidden = {"proprietaire", "owner", "numero", "parcelle", "section"}
    for feature in result["data"]["features"]:
        assert not forbidden & set(feature["properties"])


def test_committed_file_under_a_few_mb():
    size_mb = (REPO_ROOT / "data" / "geo" / "cadastre_batiments_clipped.geojson").stat().st_size / 1e6
    assert size_mb < 5


def test_missing_file_returns_error_result_not_crash(tmp_path):
    result = loader.get(data_path=tmp_path / "missing.geojson")
    VALIDATOR.validate(result)
    assert result["status"] == "error"
    assert result["data"]["features"] == []
