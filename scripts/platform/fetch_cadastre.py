#!/usr/bin/env python3
"""Ticket #30 — download Etalab cadastre buildings for the demo commune,
clip to the frozen demo bbox, simplify, and write the committed GeoJSON.

Usage: python3 scripts/platform/fetch_cadastre.py [insee ...]
Default communes: 34108 (Frontignan) + 34333 (Vic-la-Gardiole) — the bbox
straddles both. Only geometry + a building id/type are kept: NO owner or
property data (none is present in the batiments layer anyway).
"""

import gzip
import io
import json
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = REPO_ROOT / "data" / "geo" / "cadastre_batiments_clipped.geojson"

# Frozen demo bbox (docs/DATA_SOURCES.md)
MIN_LON, MIN_LAT, MAX_LON, MAX_LAT = 3.73, 43.44, 3.77, 43.47

URL = (
    "https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/"
    "communes/{dep}/{insee}/cadastre-{insee}-batiments.json.gz"
)

ALLOWED_PROPERTIES = ("type", "nom", "commune")  # never owner/parcel data


def rings(geometry: dict):
    if geometry["type"] == "Polygon":
        yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield from polygon


def intersects_bbox(geometry: dict) -> bool:
    return any(
        MIN_LON <= lon <= MAX_LON and MIN_LAT <= lat <= MAX_LAT
        for ring in rings(geometry)
        for lon, lat in ring
    )


def simplify(geometry: dict) -> dict:
    """Round to 5 decimals (~1 m) — enough for map rendering, shrinks the file."""

    def round_ring(ring):
        return [[round(lon, 5), round(lat, 5)] for lon, lat in ring]

    if geometry["type"] == "Polygon":
        coords = [round_ring(r) for r in geometry["coordinates"]]
    else:
        coords = [[round_ring(r) for r in poly] for poly in geometry["coordinates"]]
    return {"type": geometry["type"], "coordinates": coords}


def main() -> int:
    insee_codes = sys.argv[1:] or ["34108", "34333"]
    kept = []
    for insee in insee_codes:
        url = URL.format(dep=insee[:2], insee=insee)
        print(f"downloading {insee}...")
        with urllib.request.urlopen(url, timeout=60) as resp:
            raw = gzip.decompress(resp.read())
        collection = json.load(io.BytesIO(raw))
        total = len(collection["features"])
        for feature in collection["features"]:
            if not intersects_bbox(feature["geometry"]):
                continue
            props = feature.get("properties") or {}
            kept.append(
                {
                    "type": "Feature",
                    "geometry": simplify(feature["geometry"]),
                    "properties": {
                        "building_id": feature.get("id"),
                        "insee": insee,
                        **{k: props[k] for k in ALLOWED_PROPERTIES if k in props},
                    },
                }
            )
        print(f"  {insee}: {total} buildings, kept those intersecting the bbox")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({"type": "FeatureCollection", "features": kept}, separators=(",", ":"))
        + "\n"
    )
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"wrote {len(kept)} buildings -> {OUT_PATH.relative_to(REPO_ROOT)} ({size_kb:.0f} kB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
