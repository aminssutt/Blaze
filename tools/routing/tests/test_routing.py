"""Acceptance tests for the BLAZE routing tool (issue #33).

Scenarios:
1. D17 blocked for CCF -> Alpha 3 (CCF) to Water Point 2 gets the North Access
   route; the D17 route is rejected with reason "blocked_for_vehicle".
2. Light vehicle on D17 restricted to "light only" (Audio 4 correction) passes.
3. Danger polygon over the D17 corridor -> routing avoids it (danger_zone).
"""

import sys
from pathlib import Path

# Make `tools.routing` importable without packaging the repo.
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from tools.routing.router import compute_route  # noqa: E402

TOOL_RESULT_REQUIRED_KEYS = {
    "tool_call_id",
    "tool_name",
    "status",
    "source_type",
    "source_name",
    "retrieved_at",
    "is_cached",
}

# Narrow band hugging the D17 segment between Alpha 3 and D17 North
# (does not touch Forest Track 5 or the North Access corridor).
D17_CORRIDOR_DANGER_POLYGON = [
    [43.4510, 3.7475],
    [43.4510, 3.7505],
    [43.4555, 3.7575],
    [43.4555, 3.7545],
]


def assert_tool_result_shape(result: dict) -> None:
    assert TOOL_RESULT_REQUIRED_KEYS <= set(result.keys())
    assert result["source_type"] == "seeded_demo"
    assert result["source_name"] == "routing-graph"
    assert result["tool_name"] == "routing.compute_route"
    assert result["is_cached"] is False
    assert result["status"] in {"success", "error", "timeout", "fallback"}


def test_d17_blocked_for_ccf_alpha3_takes_north_access():
    result = compute_route(
        {
            "vehicle_type": "ccf",
            "origin": "alpha-3",
            "destination": "water-point-2",
            "blocked_edges": [
                {
                    "road_id": "d17",
                    "vehicle_types": ["CCF"],
                    "reason": "D17 blocked for heavy vehicles",
                }
            ],
        },
        tool_call_id="test-scenario-1",
    )
    assert_tool_result_shape(result)
    assert result["status"] == "success"
    data = result["data"]

    selected = data["selected_route"]
    assert selected is not None
    assert "north-access" in selected["roads"]
    assert "d17" not in selected["roads"]
    assert selected["vehicle_compatible"] is True
    assert selected["travel_time_min"] > 0
    assert len(selected["geometry"]) >= 2
    assert selected["geometry"][-1] == {"lat": 43.4620, "lon": 3.7350}

    # The (faster) D17 route must be reported as rejected with the reason.
    d17_rejects = [r for r in data["rejected_routes"] if "d17" in r.get("roads", [])]
    assert d17_rejects, "expected a rejected route using D17"
    assert d17_rejects[0]["reason"] == "blocked_for_vehicle"
    assert data["vehicle_compatibility"]["compatible"] is True


def test_light_vehicle_allowed_on_restricted_d17():
    # Audio 4 correction: D17 restricted to light vehicles only, not closed.
    result = compute_route(
        {
            "vehicle_type": "light",
            "origin": "charlie-1",
            "destination": "alpha-3",
            "restricted_edges": [
                {"road_id": "d17", "allowed_vehicle_types": ["light_vehicle"]}
            ],
        },
        tool_call_id="test-scenario-2",
    )
    assert_tool_result_shape(result)
    assert result["status"] == "success"
    data = result["data"]

    selected = data["selected_route"]
    assert selected is not None
    assert selected["roads"] == ["d17"]
    assert selected["vehicle_compatible"] is True
    assert data["rejected_routes"] == []
    assert data["travel_time_min"] > 0

    # Sanity: the same restriction must reject a CCF on D17.
    ccf = compute_route(
        {
            "vehicle_type": "ccf",
            "origin": "charlie-1",
            "destination": "alpha-3",
            "restricted_edges": [
                {"road_id": "d17", "allowed_vehicle_types": ["light_vehicle"]}
            ],
        }
    )
    ccf_rejected = ccf["data"]["rejected_routes"]
    assert any(r["reason"] == "blocked_for_vehicle" for r in ccf_rejected)


def test_danger_polygon_on_corridor_is_avoided():
    result = compute_route(
        {
            "vehicle_type": "light",
            "origin": "charlie-1",
            "destination": "hangar-zone",
            "danger_polygons": [
                {
                    "polygon_id": "fire-front-d17",
                    "coordinates": D17_CORRIDOR_DANGER_POLYGON,
                }
            ],
        },
        tool_call_id="test-scenario-3",
    )
    assert_tool_result_shape(result)
    assert result["status"] == "success"
    data = result["data"]

    selected = data["selected_route"]
    assert selected is not None
    # Detour through Forest Track 5 instead of the D17 corridor.
    assert "forest-track-5" in selected["roads"]

    # The fast D17 corridor route is rejected because of the danger zone.
    danger_rejects = [
        r for r in data["rejected_routes"] if r["reason"] == "danger_zone"
    ]
    assert danger_rejects, "expected a route rejected for danger_zone"
    assert any("fire-front-d17" in v["detail"] for v in danger_rejects[0]["violations"])

    # No selected edge may cross the polygon corridor segment (alpha-3 -> d17-north).
    selected_edge_ids = [e["edge_id"] for e in selected["edges"]]
    assert "d17-d" not in selected_edge_ids


def test_no_path_reported_when_everything_blocked():
    result = compute_route(
        {
            "vehicle_type": "ccf",
            "origin": "command-post",
            "destination": "water-point-2",
            "blocked_edges": [
                {"road_id": "d17"},
                {"road_id": "north-access-link"},
                {"road_id": "ft5-link"},
            ],
        }
    )
    assert_tool_result_shape(result)
    data = result["data"]
    assert data["selected_route"] is None
    assert data["rejected_routes"][-1]["reason"] == "no_path"
    assert data["vehicle_compatibility"]["route_found"] is False


def test_unknown_location_returns_error_tool_result():
    result = compute_route(
        {"vehicle_type": "any", "origin": "alpha-3", "destination": "nowhere-99"}
    )
    assert_tool_result_shape(result)
    assert result["status"] == "error"
    assert result["data"] is None
    assert "nowhere-99" in result["error"]
