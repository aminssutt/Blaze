"""BLAZE elevation adapter — Open-Meteo Elevation API + local slope estimate.

Standalone module (issue #28). Queries elevation for 5 points around the demo
bbox center (~43.45N, 3.75E): the center plus 4 offsets (N/S/E/W, ~500 m),
derives a simple local slope estimate from elevation differences over
distance, normalizes to the ToolResult contract
(contracts/schemas/tool_result.schema.json), and caches the demo response
under data/cached_external/ for offline mode.

Modes (see get()):
  - live   : call the real API (and refresh the cache).
  - cached : serve data/cached_external/openmeteo_elevation_demo.json.
  - auto   : decided from USE_CACHED_EXTERNAL_DATA / NETWORK_MODE env vars,
             with a silent live -> cache fallback on any network error.
"""

from __future__ import annotations

import copy
import json
import math
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

TOOL_NAME = "elevation"
SOURCE_NAME = "open-meteo-elevation"
API_URL = "https://api.open-meteo.com/v1/elevation"
REQUEST_TIMEOUT_S = 10.0

# Demo bbox center (Occitanie scenario, ~43.45N 3.75E).
DEMO_LAT = 43.45
DEMO_LON = 3.75

# ~500 m offset in degrees of latitude.
OFFSET_DEG_LAT = 0.0045
EARTH_DEG_LAT_M = 111_320.0  # meters per degree of latitude


def _demo_points(lat: float, lon: float) -> List[Dict[str, Any]]:
    """Center + 4 compass points ~500 m away."""
    dlat = OFFSET_DEG_LAT
    # Scale the longitude offset so east/west points are also ~500 m away.
    dlon = OFFSET_DEG_LAT / math.cos(math.radians(lat))
    return [
        {"id": "center", "latitude": lat, "longitude": lon},
        {"id": "north", "latitude": lat + dlat, "longitude": lon},
        {"id": "south", "latitude": lat - dlat, "longitude": lon},
        {"id": "east", "latitude": lat, "longitude": lon + dlon},
        {"id": "west", "latitude": lat, "longitude": lon - dlon},
    ]


_REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_PATH = _REPO_ROOT / "data" / "cached_external" / "openmeteo_elevation_demo.json"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def compute_slope(points: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Simple local slope from elevation differences over distance.

    Uses central differences between the north/south and east/west points to
    estimate the terrain gradient at the center, then reports the slope
    magnitude (percent and degrees) and the downhill direction.
    """
    by_id = {p["id"]: p for p in points}
    north, south = by_id["north"], by_id["south"]
    east, west = by_id["east"], by_id["west"]

    ns_dist = _haversine_m(south["latitude"], south["longitude"], north["latitude"], north["longitude"])
    ew_dist = _haversine_m(west["latitude"], west["longitude"], east["latitude"], east["longitude"])

    # Gradient components (m of elevation per m of horizontal distance).
    dz_dn = (north["elevation_m"] - south["elevation_m"]) / ns_dist  # + = rises northward
    dz_de = (east["elevation_m"] - west["elevation_m"]) / ew_dist    # + = rises eastward

    gradient = math.hypot(dz_dn, dz_de)
    # Downhill azimuth (degrees clockwise from north): opposite of the ascent direction.
    if gradient > 0:
        downhill_deg = (math.degrees(math.atan2(-dz_de, -dz_dn)) + 360.0) % 360.0
    else:
        downhill_deg = None

    return {
        "method": "central_difference_4_neighbors",
        "north_south_distance_m": round(ns_dist, 1),
        "east_west_distance_m": round(ew_dist, 1),
        "slope_north_pct": round(dz_dn * 100.0, 3),
        "slope_east_pct": round(dz_de * 100.0, 3),
        "slope_pct": round(gradient * 100.0, 3),
        "slope_deg": round(math.degrees(math.atan(gradient)), 3),
        "downhill_azimuth_deg": round(downhill_deg, 1) if downhill_deg is not None else None,
    }


def normalize(
    raw: Dict[str, Any],
    points: List[Dict[str, Any]],
    retrieved_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Normalize a raw Open-Meteo /v1/elevation payload into a ToolResult dict.

    `points` are the queried points (id/latitude/longitude) in the same order
    as the elevations in `raw["elevation"]`.
    """
    retrieved_at = retrieved_at or _utcnow_iso()
    elevations = raw.get("elevation") or []
    if len(elevations) != len(points):
        raise ValueError(
            f"elevation count mismatch: got {len(elevations)}, expected {len(points)}"
        )

    enriched = [
        {**p, "elevation_m": float(e)}
        for p, e in zip(points, elevations)
    ]

    data = {
        "center": {"latitude": points[0]["latitude"], "longitude": points[0]["longitude"]},
        "points": enriched,
        "slope": compute_slope(enriched),
        "units": {"elevation": "m", "slope": "%"},
    }

    return {
        "tool_call_id": f"elevation-{uuid.uuid4().hex[:12]}",
        "tool_name": TOOL_NAME,
        "status": "success",
        "data": data,
        "source_type": "live_public",
        "source_name": SOURCE_NAME,
        "retrieved_at": retrieved_at,
        # Elevation is static terrain data; retrieval time is the best timestamp.
        "data_timestamp": retrieved_at,
        "is_cached": False,
        "staleness_seconds": 0,
        "error": None,
    }


def fetch_live(
    lat: float = DEMO_LAT,
    lon: float = DEMO_LON,
    write_cache: bool = True,
    cache_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Call the real Open-Meteo Elevation API and return a normalized ToolResult."""
    points = _demo_points(lat, lon)
    params = {
        "latitude": ",".join(f"{p['latitude']:.6f}" for p in points),
        "longitude": ",".join(f"{p['longitude']:.6f}" for p in points),
    }
    response = requests.get(API_URL, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    result = normalize(response.json(), points)

    if write_cache:
        path = cache_path or CACHE_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


def fetch_cached(cache_path: Optional[Path] = None) -> Dict[str, Any]:
    """Serve the cached demo response with cached_public provenance + staleness."""
    path = cache_path or CACHE_PATH
    cached = json.loads(path.read_text(encoding="utf-8"))

    result = copy.deepcopy(cached)
    now = datetime.now(timezone.utc)
    reference = result.get("data_timestamp") or result.get("retrieved_at")
    staleness: Optional[float] = None
    if reference:
        staleness = max(0.0, (now - _parse_iso(reference)).total_seconds())

    result["tool_call_id"] = f"elevation-{uuid.uuid4().hex[:12]}"
    result["status"] = "success"
    result["source_type"] = "cached_public"
    result["is_cached"] = True
    result["retrieved_at"] = now.isoformat(timespec="seconds")
    result["staleness_seconds"] = staleness
    result["error"] = None
    return result


def _mode_from_env() -> str:
    use_cached = os.getenv("USE_CACHED_EXTERNAL_DATA", "true").strip().lower()
    network_mode = os.getenv("NETWORK_MODE", "online").strip().lower()
    if network_mode == "offline" or use_cached in ("1", "true", "yes"):
        return "cached"
    return "live"


def get(mode: Optional[str] = None, cache_path: Optional[Path] = None) -> Dict[str, Any]:
    """Return elevation + local slope as a ToolResult.

    mode: "live", "cached", or None/"auto" (resolved from env vars).
    Live errors fall back silently to the cache (status="fallback").
    """
    resolved = (mode or "auto").strip().lower()
    if resolved == "auto":
        resolved = _mode_from_env()

    if resolved == "cached":
        return fetch_cached(cache_path=cache_path)

    try:
        return fetch_live(cache_path=cache_path)
    except Exception as exc:  # noqa: BLE001 — silent fallback to cache by design
        try:
            result = fetch_cached(cache_path=cache_path)
            result["status"] = "fallback"
            result["error"] = f"live fetch failed, served cache: {exc}"
            return result
        except Exception as cache_exc:  # noqa: BLE001
            return {
                "tool_call_id": f"elevation-{uuid.uuid4().hex[:12]}",
                "tool_name": TOOL_NAME,
                "status": "error",
                "data": None,
                "source_type": "live_public",
                "source_name": SOURCE_NAME,
                "retrieved_at": _utcnow_iso(),
                "data_timestamp": None,
                "is_cached": False,
                "staleness_seconds": None,
                "error": f"live fetch failed ({exc}); cache unavailable ({cache_exc})",
            }


if __name__ == "__main__":
    print(json.dumps(get(mode="live"), indent=2, ensure_ascii=False))
