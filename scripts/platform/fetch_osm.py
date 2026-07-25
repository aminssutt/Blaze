#!/usr/bin/env python3
"""Ticket #31 — one-time Overpass query for the demo bbox, cached as GeoJSON.

Fetches roads/tracks, campings, water points (hydrants/tanks/water), industrial
buildings and critical assets (hospital, fire station, power substation), and
writes data/geo/osm_features.geojson. Run BEFORE the event: the loader only
ever serves the committed file — no live Overpass dependency during the pitch.

Usage: python3 scripts/platform/fetch_osm.py
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = REPO_ROOT / "data" / "geo" / "osm_features.geojson"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Frozen demo bbox — Overpass order is south,west,north,east
QUERY = """
[out:json][timeout:90][bbox:43.44,3.73,43.47,3.77];
(
  way[highway~"^(primary|secondary|tertiary|unclassified|residential|service|track|path)$"];
  node[emergency~"^(fire_hydrant|water_tank)$"];
  node[tourism=camp_site]; way[tourism=camp_site];
  way[landuse=industrial];
  way[building=industrial];
  node[amenity~"^(hospital|fire_station)$"]; way[amenity~"^(hospital|fire_station)$"];
  node[power=substation]; way[power=substation];
  way[natural=water];
);
out geom;
"""

KEPT_TAGS = (
    "highway", "name", "ref", "surface", "tracktype", "emergency", "tourism",
    "landuse", "building", "amenity", "power", "natural", "access",
)


def categorize(tags: dict) -> str:
    if "highway" in tags:
        return "track" if tags["highway"] in ("track", "path") else "road"
    if tags.get("emergency") in ("fire_hydrant", "water_tank") or tags.get("natural") == "water":
        return "water_point"
    if tags.get("tourism") == "camp_site":
        return "camping"
    if tags.get("landuse") == "industrial" or tags.get("building") == "industrial":
        return "industrial"
    return "critical_asset"  # hospital, fire_station, substation


def to_feature(element: dict) -> dict:
    tags = element.get("tags", {})
    if element["type"] == "node":
        geometry = {"type": "Point", "coordinates": [element["lon"], element["lat"]]}
    else:
        coords = [[p["lon"], p["lat"]] for p in element.get("geometry", [])]
        closed = len(coords) > 3 and coords[0] == coords[-1]
        area = closed and not ("highway" in tags)
        geometry = (
            {"type": "Polygon", "coordinates": [coords]}
            if area
            else {"type": "LineString", "coordinates": coords}
        )
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "osm_id": f"{element['type']}/{element['id']}",
            "category": categorize(tags),
            **{k: tags[k] for k in KEPT_TAGS if k in tags},
        },
    }


def main() -> int:
    request = urllib.request.Request(
        OVERPASS_URL,
        data=("data=" + urllib.parse.quote(QUERY)).encode(),
        headers={
            "User-Agent": "BLAZE-wildfire-demo/1.0 (hackathon; contact via github aminssutt/Blaze)",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as resp:
        payload = json.load(resp)

    features = [to_feature(e) for e in payload["elements"] if e.get("tags")]
    counts: dict[str, int] = {}
    for f in features:
        counts[f["properties"]["category"]] = counts.get(f["properties"]["category"], 0) + 1

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
        + "\n"
    )
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"wrote {len(features)} features ({size_kb:.0f} kB): {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
