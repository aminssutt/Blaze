"""BLAZE cadastre loader — Etalab buildings, clipped demo commune (issue #30).

Serves data/geo/cadastre_batiments_clipped.geojson (downloaded + clipped by
scripts/platform/fetch_cadastre.py before the event) as a ToolResult with
cached_public provenance. Fully local at demo time — no network, ever.
The committed file contains geometry and building type only: NO owner or
property data.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

TOOL_NAME = "cadastre_buildings"
SOURCE_NAME = "cadastre-etalab"

_REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = _REPO_ROOT / "data" / "geo" / "cadastre_batiments_clipped.geojson"

_cache: Optional[dict] = None


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load(data_path: Optional[Path] = None) -> dict:
    global _cache
    if data_path is not None:
        return json.loads(Path(data_path).read_text(encoding="utf-8"))
    if _cache is None:
        _cache = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return _cache


def _feature_intersects(feature: dict, bbox: Tuple[float, float, float, float]) -> bool:
    min_lon, min_lat, max_lon, max_lat = bbox
    geometry = feature["geometry"]
    rings = (
        geometry["coordinates"]
        if geometry["type"] == "Polygon"
        else [ring for polygon in geometry["coordinates"] for ring in polygon]
    )
    return any(
        min_lon <= lon <= max_lon and min_lat <= lat <= max_lat
        for ring in rings
        for lon, lat in ring
    )


def get(
    bbox: Optional[Tuple[float, float, float, float]] = None,
    data_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Buildings as a ToolResult (optionally sub-filtered by bbox WSEN)."""
    try:
        collection = _load(data_path)
    except Exception as exc:  # noqa: BLE001 — missing file must not crash a run
        return {
            "tool_call_id": f"cadastre-{uuid.uuid4().hex[:12]}",
            "tool_name": TOOL_NAME,
            "status": "error",
            "data": {"building_count": 0, "features": []},
            "source_type": "cached_public",
            "source_name": SOURCE_NAME,
            "retrieved_at": _utcnow_iso(),
            "data_timestamp": None,
            "is_cached": True,
            "staleness_seconds": None,
            "error": f"cadastre file unavailable: {exc}",
        }

    features = collection["features"]
    if bbox is not None:
        features = [f for f in features if _feature_intersects(f, bbox)]

    return {
        "tool_call_id": f"cadastre-{uuid.uuid4().hex[:12]}",
        "tool_name": TOOL_NAME,
        "status": "success",
        "data": {
            "building_count": len(features),
            "features": features,
            "bbox_filter_wsen": list(bbox) if bbox else None,
        },
        "source_type": "cached_public",
        "source_name": SOURCE_NAME,
        "retrieved_at": _utcnow_iso(),
        "data_timestamp": None,
        "is_cached": True,
        "staleness_seconds": None,
        "error": None,
    }
