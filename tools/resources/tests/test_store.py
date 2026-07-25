import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from tools.resources.store import SECTIONS, ScenarioStore

REPO_ROOT = Path(__file__).resolve().parents[3]
TOOL_RESULT_SCHEMA = json.loads(
    (REPO_ROOT / "contracts" / "schemas" / "tool_result.schema.json").read_text()
)
VALIDATOR = Draft7Validator(TOOL_RESULT_SCHEMA)


def test_all_sections_queryable_with_seeded_demo_provenance():
    store = ScenarioStore()
    for section in SECTIONS:
        result = store.get(section)
        VALIDATOR.validate(result)
        assert result["source_type"] == "seeded_demo"
        assert result["status"] == "success"


def test_seeded_scenario_content_present():
    store = ScenarioStore()
    units = {u["unit_id"]: u for u in store.get("units")["data"]["units"]}
    assert units["alpha-3"]["water_pct"] == 65
    assert units["alpha-3"]["vehicle_type"] == "CCF"
    roads = [r["road_id"] for r in store.get("roads")["data"]["roads"]]
    assert "d17" in roads
    assert any(
        r["resource_id"] == "water-point-2"
        for r in store.get("resources")["data"]["resources"]
    )
    assert store.get("safety_rules")["data"]["rules"]


def test_updates_persist_during_a_run():
    store = ScenarioStore()
    result = store.update("units", "alpha-3", {"water_pct": 30})
    VALIDATOR.validate(result)
    assert result["data"]["water_pct"] == 30
    assert store.get_item("units", "alpha-3")["data"]["water_pct"] == 30

    store.update("roads", "d17", {"status": "restricted", "blocked_for": ["CCF"]})
    d17 = store.get_item("roads", "d17")["data"]
    assert d17["status"] == "restricted"
    assert d17["blocked_for"] == ["CCF"]


def test_reset_restores_initial_seeded_state_exactly():
    store = ScenarioStore()
    before = {s: store.get(s)["data"] for s in SECTIONS}
    store.update("units", "alpha-3", {"water_pct": 5, "status": "retreating"})
    store.update("roads", "d17", {"status": "blocked"})
    store.reset()
    after = {s: store.get(s)["data"] for s in SECTIONS}
    assert after == before


def test_query_results_are_snapshots_not_live_references():
    store = ScenarioStore()
    snapshot = store.get("units")["data"]
    snapshot["units"][0]["water_pct"] = 1
    assert store.get_item("units", "alpha-3")["data"]["water_pct"] == 65


def test_unknown_section_or_id_raises():
    store = ScenarioStore()
    with pytest.raises(KeyError):
        store.get("nope")
    with pytest.raises(KeyError):
        store.update("units", "delta-9", {"status": "x"})
