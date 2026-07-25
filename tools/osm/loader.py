"""BLAZE OSM loader — Overpass features cached for the demo bbox (issue #31).

Serves data/geo/osm_features.geojson (fetched once before the event by
scripts/platform/fetch_osm.py) as a ToolResult with cached_public provenance.

The loader NEVER calls Overpass when USE_CACHED_EXTERNAL_DATA=true (the demo
default) or NETWORK_MODE=offline — refreshing the cache is an explicit,
pre-event action (mode="refresh").
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

TOOL_NAME = "osm_features"
SOURCE_NAME = "openstreetmap-overpass"

_REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = _REPO_ROOT / "data" / "geo" / "osm_features.geojson"

CATEGORIES = ("road", "track", "water_point", "camping", "industrial", "critical_asset")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _cache_only() -> bool:
    use_cached = os.getenv("USE_CACHED_EXTERNAL_DATA", "true").strip().lower()
    network_mode = os.getenv("NETWORK_MODE", "online").strip().lower()
    return network_mode == "offline" or use_cached in ("1", "true", "yes")


def get(
    category: Optional[str] = None,
    mode: str = "cached",
    data_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """OSM features as a ToolResult (optionally one category).

    mode="cached" (default) always serves the committed file. mode="refresh"
    re-runs the Overpass fetch — refused when USE_CACHED_EXTERNAL_DATA=true or
    NETWORK_MODE=offline, per the no-live-Overpass-during-the-pitch rule.
    """
    if mode == "refresh":
        if _cache_only():
            raise RuntimeError(
                "Overpass refresh refused: USE_CACHED_EXTERNAL_DATA/NETWORK_MODE "
                "mandate cache-only (run scripts/platform/fetch_osm.py pre-event)"
            )
        import subprocess  # pre-event only, never during the demo
        import sys

        subprocess.run(
            [sys.executable, str(_REPO_ROOT / "scripts" / "platform" / "fetch_osm.py")],
            check=True,
        )

    path = Path(data_path) if data_path else DATA_PATH
    try:
        collection = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 — missing cache must not crash a run
        return {
            "tool_call_id": f"osm-{uuid.uuid4().hex[:12]}",
            "tool_name": TOOL_NAME,
            "status": "error",
            "data": {"feature_count": 0, "features": [], "category_filter": category},
            "source_type": "cached_public",
            "source_name": SOURCE_NAME,
            "retrieved_at": _utcnow_iso(),
            "data_timestamp": None,
            "is_cached": True,
            "staleness_seconds": None,
            "error": f"osm cache unavailable: {exc}",
        }

    features = collection["features"]
    if category is not None:
        if category not in CATEGORIES:
            raise KeyError(f"unknown category {category!r} (expected {CATEGORIES})")
        features = [f for f in features if f["properties"]["category"] == category]

    counts: Dict[str, int] = {}
    for f in features:
        counts[f["properties"]["category"]] = counts.get(f["properties"]["category"], 0) + 1

    return {
        "tool_call_id": f"osm-{uuid.uuid4().hex[:12]}",
        "tool_name": TOOL_NAME,
        "status": "success",
        "data": {
            "feature_count": len(features),
            "category_counts": counts,
            "features": features,
            "category_filter": category,
        },
        "source_type": "cached_public",
        "source_name": SOURCE_NAME,
        "retrieved_at": _utcnow_iso(),
        "data_timestamp": None,
        "is_cached": True,
        "staleness_seconds": None,
        "error": None,
    }
