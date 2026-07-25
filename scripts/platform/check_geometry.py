#!/usr/bin/env python3
"""Ticket #7 — verify every seeded coordinate is inside the demo bbox and
mutually coherent, and emit a GeoJSON preview of the scenario geometry.

Usage: python3 scripts/platform/check_geometry.py
Exits non-zero if any coordinate falls outside the bbox.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Frozen demo bbox (also in the incident.started mock payload and DATA_SOURCES.md)
BBOX = {"min_lat": 43.44, "min_lon": 3.73, "max_lat": 43.47, "max_lon": 3.77}

PREVIEW_PATH = REPO_ROOT / "data" / "geo" / "scenario_preview.geojson"


def inside(lat: float, lon: float) -> bool:
    return (
        BBOX["min_lat"] <= lat <= BBOX["max_lat"]
        and BBOX["min_lon"] <= lon <= BBOX["max_lon"]
    )


def main() -> int:
    scenario = REPO_ROOT / "data" / "scenario"
    features, problems = [], []

    def check(label: str, lat: float, lon: float, props: dict) -> None:
        if not inside(lat, lon):
            problems.append(f"{label}: ({lat}, {lon}) outside bbox")
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"label": label, **props},
            }
        )

    units = json.loads((scenario / "units.json").read_text())
    for u in units["units"]:
        if u.get("position"):
            check(f"unit:{u['unit_id']}", u["position"]["lat"], u["position"]["lon"],
                  {"kind": "unit", "vehicle_type": u.get("vehicle_type")})
    cp = units.get("command_post")
    if cp and cp.get("position"):
        check("command_post", cp["position"]["lat"], cp["position"]["lon"], {"kind": "command_post"})

    resources = json.loads((scenario / "resources.json").read_text())
    for r in resources["resources"]:
        if r.get("position"):
            check(f"resource:{r['resource_id']}", r["position"]["lat"], r["position"]["lon"],
                  {"kind": "resource", "type": r.get("type")})

    roads = json.loads((scenario / "roads.json").read_text())
    for road in roads["roads"]:
        coords = []
        for i, pt in enumerate(road.get("geometry", [])):
            if not inside(pt["lat"], pt["lon"]):
                problems.append(f"road:{road['road_id']}[{i}]: ({pt['lat']}, {pt['lon']}) outside bbox")
            coords.append([pt["lon"], pt["lat"]])
        if coords:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {"label": f"road:{road['road_id']}", "kind": "road",
                                   "status": road.get("status")},
                }
            )

    # bbox outline for the preview
    features.append(
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [BBOX["min_lon"], BBOX["min_lat"]],
                    [BBOX["max_lon"], BBOX["min_lat"]],
                    [BBOX["max_lon"], BBOX["max_lat"]],
                    [BBOX["min_lon"], BBOX["max_lat"]],
                    [BBOX["min_lon"], BBOX["min_lat"]],
                ]],
            },
            "properties": {"label": "demo_bbox", "kind": "bbox"},
        }
    )

    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, indent=2) + "\n"
    )

    point_count = sum(1 for f in features if f["geometry"]["type"] == "Point")
    print(f"bbox: {BBOX}")
    print(f"checked: {point_count} points + {len(roads['roads'])} roads")
    print(f"preview: {PREVIEW_PATH.relative_to(REPO_ROOT)} (drop it on geojson.io)")
    if problems:
        print("\nOUT OF BBOX:")
        for p in problems:
            print(" -", p)
        return 1
    print("all coordinates inside the bbox ✔")
    return 0


if __name__ == "__main__":
    sys.exit(main())
