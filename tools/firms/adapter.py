"""BLAZE FIRMS adapter — NASA active-fire hotspots (Area API).

Standalone module (issue #29), same shape as tools/weather. Fetches VIIRS
hotspots for the demo bbox with NASA_FIRMS_MAP_KEY, normalizes the CSV to the
ToolResult contract (contracts/schemas/tool_result.schema.json), caches the
normalized result under data/cached_external/, and serves the cache offline.

FIRMS must NEVER block the demo: any live failure (missing key, network down,
error body, empty body) falls back silently to the cache with clear labeling,
and the optional on_fallback callback lets the backend emit fallback.activated.

Modes (see get()):
  - live   : call the real Area API (and refresh the cache).
  - cached : serve data/cached_external/firms_hotspots_demo.json.
  - auto   : decided from USE_CACHED_EXTERNAL_DATA / NETWORK_MODE env vars,
             with a silent live -> cache fallback on any error.
"""

from __future__ import annotations

import copy
import csv
import io
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import requests

TOOL_NAME = "firms_hotspots"
SOURCE_NAME = "nasa-firms"
SOURCE = "VIIRS_SNPP_NRT"
API_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
REQUEST_TIMEOUT_S = 10.0

# Provisional demo bbox (Hérault, ticket #7 will freeze it): west,south,east,north
DEMO_BBOX = "3.70,43.42,3.80,43.49"
DEFAULT_DAYS = 1

_REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_PATH = _REPO_ROOT / "data" / "cached_external" / "firms_hotspots_demo.json"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _map_key() -> Optional[str]:
    """NASA_FIRMS_MAP_KEY from the environment, else from the repo .env file."""
    key = os.getenv("NASA_FIRMS_MAP_KEY")
    if key:
        return key
    env_file = _REPO_ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("NASA_FIRMS_MAP_KEY="):
                value = line.split("=", 1)[1].strip()
                if value:
                    return value
    return None


def normalize(
    csv_text: str,
    bbox: str = DEMO_BBOX,
    days: int = DEFAULT_DAYS,
    retrieved_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Normalize a FIRMS Area CSV body into a ToolResult dict."""
    retrieved_at = retrieved_at or _utcnow_iso()
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    hotspots = []
    latest: Optional[str] = None
    for row in rows:
        acq_date = row.get("acq_date", "")
        acq_time = row.get("acq_time", "0").zfill(4)
        acquired_at = (
            f"{acq_date}T{acq_time[:2]}:{acq_time[2:]}:00+00:00" if acq_date else None
        )
        if acquired_at and (latest is None or acquired_at > latest):
            latest = acquired_at
        hotspots.append(
            {
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "brightness_k": float(row.get("bright_ti4") or 0.0),
                "frp_mw": float(row.get("frp") or 0.0),
                "confidence": row.get("confidence"),
                "daynight": row.get("daynight"),
                "satellite": row.get("satellite"),
                "acquired_at": acquired_at,
            }
        )

    return {
        "tool_call_id": f"firms-{uuid.uuid4().hex[:12]}",
        "tool_name": TOOL_NAME,
        "status": "success",
        "data": {
            "bbox_wsen": bbox,
            "days": days,
            "source": SOURCE,
            "hotspot_count": len(hotspots),
            "hotspots": hotspots,
        },
        "source_type": "live_public",
        "source_name": SOURCE_NAME,
        "retrieved_at": retrieved_at,
        "data_timestamp": latest,
        "is_cached": False,
        "staleness_seconds": 0,
        "error": None,
    }


def fetch_live(
    bbox: str = DEMO_BBOX,
    days: int = DEFAULT_DAYS,
    write_cache: bool = True,
    cache_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Call the real FIRMS Area API and return a normalized ToolResult."""
    key = _map_key()
    if not key:
        raise RuntimeError("NASA_FIRMS_MAP_KEY missing (env or .env)")
    url = f"{API_BASE}/{key}/{SOURCE}/{bbox}/{days}"
    response = requests.get(url, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    body = response.text
    # FIRMS returns errors/limits as HTML or empty text, valid data as CSV.
    if not body.startswith("latitude"):
        raise RuntimeError(f"FIRMS non-CSV response: {body[:120]!r}")
    result = normalize(body, bbox=bbox, days=days)

    if write_cache:
        path = cache_path or CACHE_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
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

    result["tool_call_id"] = f"firms-{uuid.uuid4().hex[:12]}"
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


def get(
    mode: Optional[str] = None,
    bbox: str = DEMO_BBOX,
    days: int = DEFAULT_DAYS,
    cache_path: Optional[Path] = None,
    on_fallback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """Return hotspots as a ToolResult. FIRMS never blocks the demo.

    mode: "live", "cached", or None/"auto" (resolved from env vars).
    Live errors fall back silently to the cache (status="fallback") and invoke
    on_fallback (the backend uses it to emit a fallback.activated event).
    """
    resolved = (mode or "auto").strip().lower()
    if resolved == "auto":
        resolved = _mode_from_env()

    if resolved == "cached":
        return fetch_cached(cache_path=cache_path)

    try:
        return fetch_live(bbox=bbox, days=days, cache_path=cache_path)
    except Exception as exc:  # noqa: BLE001 — silent fallback to cache by design
        try:
            result = fetch_cached(cache_path=cache_path)
            result["status"] = "fallback"
            result["error"] = f"live fetch failed, served cache: {exc}"
        except Exception as cache_exc:  # noqa: BLE001 — last resort: empty, not a crash
            result = {
                "tool_call_id": f"firms-{uuid.uuid4().hex[:12]}",
                "tool_name": TOOL_NAME,
                "status": "error",
                "data": {
                    "bbox_wsen": bbox,
                    "days": days,
                    "source": SOURCE,
                    "hotspot_count": 0,
                    "hotspots": [],
                },
                "source_type": "live_public",
                "source_name": SOURCE_NAME,
                "retrieved_at": _utcnow_iso(),
                "data_timestamp": None,
                "is_cached": False,
                "staleness_seconds": None,
                "error": f"live failed ({exc}); cache failed ({cache_exc})",
            }
        if on_fallback is not None:
            on_fallback(
                {
                    "fallback": "firms_cache",
                    "tool_name": TOOL_NAME,
                    "reason": str(exc),
                    "source_type": result["source_type"],
                }
            )
        return result
