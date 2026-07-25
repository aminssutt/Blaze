"""BLAZE weather adapter — Open-Meteo forecast/current conditions.

Standalone module (issue #27). Fetches current weather for the demo bbox
center (~43.45N, 3.75E) from the free Open-Meteo API (no API key), normalizes
the response to the ToolResult contract
(contracts/schemas/tool_result.schema.json), caches it under
data/cached_external/, and can serve the cache offline with correct
source_type / staleness labelling.

Modes (see get()):
  - live   : call the real API (and refresh the cache).
  - cached : serve data/cached_external/openmeteo_weather_demo.json.
  - auto   : decided from USE_CACHED_EXTERNAL_DATA / NETWORK_MODE env vars,
             with a silent live -> cache fallback on any network error.
"""

from __future__ import annotations

import copy
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests

TOOL_NAME = "weather"
SOURCE_NAME = "open-meteo"
API_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT_S = 10.0

# Demo bbox center (Occitanie scenario, ~43.45N 3.75E).
DEMO_LAT = 43.45
DEMO_LON = 3.75

CURRENT_VARIABLES = [
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "precipitation",
]

_REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_PATH = _REPO_ROOT / "data" / "cached_external" / "openmeteo_weather_demo.json"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def normalize(raw: Dict[str, Any], retrieved_at: Optional[str] = None) -> Dict[str, Any]:
    """Normalize a raw Open-Meteo /v1/forecast payload into a ToolResult dict."""
    retrieved_at = retrieved_at or _utcnow_iso()
    current = raw.get("current") or {}
    units = raw.get("current_units") or {}

    data_timestamp: Optional[str] = None
    if current.get("time"):
        data_timestamp = _parse_iso(current["time"]).isoformat(timespec="seconds")

    data = {
        "latitude": raw.get("latitude"),
        "longitude": raw.get("longitude"),
        "elevation_m": raw.get("elevation"),
        "timezone": raw.get("timezone", "GMT"),
        "temperature_c": current.get("temperature_2m"),
        "relative_humidity_pct": current.get("relative_humidity_2m"),
        "wind_speed_kmh": current.get("wind_speed_10m"),
        "wind_direction_deg": current.get("wind_direction_10m"),
        "wind_gusts_kmh": current.get("wind_gusts_10m"),
        "precipitation_mm": current.get("precipitation"),
        "units": {
            "temperature": units.get("temperature_2m", "°C"),
            "relative_humidity": units.get("relative_humidity_2m", "%"),
            "wind_speed": units.get("wind_speed_10m", "km/h"),
            "wind_direction": units.get("wind_direction_10m", "°"),
            "wind_gusts": units.get("wind_gusts_10m", "km/h"),
            "precipitation": units.get("precipitation", "mm"),
        },
    }

    return {
        "tool_call_id": f"weather-{uuid.uuid4().hex[:12]}",
        "tool_name": TOOL_NAME,
        "status": "success",
        "data": data,
        "source_type": "live_public",
        "source_name": SOURCE_NAME,
        "retrieved_at": retrieved_at,
        "data_timestamp": data_timestamp,
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
    """Call the real Open-Meteo API and return a normalized ToolResult.

    On success the normalized result is persisted to the demo cache so the
    offline mode always has a scenario response to serve.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join(CURRENT_VARIABLES),
        "wind_speed_unit": "kmh",
        "timezone": "UTC",
        "timeformat": "iso8601",
    }
    response = requests.get(API_URL, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    result = normalize(response.json())

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

    result["tool_call_id"] = f"weather-{uuid.uuid4().hex[:12]}"
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
    """Return current weather as a ToolResult.

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
                "tool_call_id": f"weather-{uuid.uuid4().hex[:12]}",
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
