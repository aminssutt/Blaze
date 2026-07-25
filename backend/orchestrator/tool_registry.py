"""BLAZE tool registry — allowlist of tools Gemma agents may call (issue #26).

This module is the ONLY path from a Gemma function call to executable code.
Every tool is a static :class:`ToolSpec` registered in code: name, JSON Schema
for its arguments, a plain Python callable, a per-tool timeout and provenance
defaults (source_type / source_name). There is NO eval, NO exec and NO
model-driven dynamic import anywhere in this layer: if a name is not in the
registry, it is never executed.

Initial registry (see :func:`build_default_registry`):

  - ``get_weather``   -> tools.weather.adapter.get        (merged, available)
  - ``get_elevation`` -> tools.elevation.adapter.get      (merged, available)
  - ``compute_route`` -> tools.routing.router.compute_route (merged, available)
  - ``get_firms`` / ``get_cadastre`` / ``get_osm`` / ``get_resources``
                    -> interface-only stubs, marked unavailable until their
                       adapters are merged (executing them returns a
                       structured ``tool_unavailable`` error, never code).

Cache-fallback convention: a tool that supports serving from local cache sets
``supports_cached_mode=True`` and its callable accepts ``mode="cached"``.
On timeout the executor re-invokes the callable with ``mode="cached"``.

Imports of ``tools.*`` resolve from the REPO ROOT (the adapters live in
``tools/<name>/``, importable as namespace packages). Run pytest / the app
from the repo root, or rely on ``backend/orchestrator/tests/conftest.py``
which prepends the repo root to ``sys.path``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Tool spec
# ---------------------------------------------------------------------------

#: Allowed provenance categories (mirrors tool_result.schema.json enum).
SOURCE_TYPES = (
    "live_public",
    "cached_public",
    "seeded_demo",
    "human_report",
    "model_inference",
)

DEFAULT_TIMEOUT_S = 15.0


@dataclass(frozen=True)
class ToolSpec:
    """One allowlisted tool.

    handler is a plain callable invoked as ``handler(**validated_arguments)``
    and must return either a full ToolResult-shaped dict (preferred — the
    merged adapters already do) or a raw JSON-serializable payload that the
    executor wraps using the provenance defaults below.
    """

    name: str
    description: str
    args_schema: Dict[str, Any]
    handler: Optional[Callable[..., Any]]
    timeout_s: float
    source_type: str
    source_name: str
    supports_cached_mode: bool = False
    available: bool = True

    def __post_init__(self) -> None:
        if not isinstance(self.args_schema, dict):
            raise TypeError(f"tool '{self.name}': args_schema must be a dict (JSON Schema)")
        if self.source_type not in SOURCE_TYPES:
            raise ValueError(
                f"tool '{self.name}': source_type '{self.source_type}' not in {SOURCE_TYPES}"
            )
        if self.available and not callable(self.handler):
            raise ValueError(f"tool '{self.name}': available tools require a callable handler")
        if self.timeout_s <= 0:
            raise ValueError(f"tool '{self.name}': timeout_s must be > 0")


class ToolRegistry:
    """Append-only-by-default allowlist of ToolSpecs (name -> spec)."""

    def __init__(self) -> None:
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec, replace: bool = False) -> None:
        if spec.name in self._tools and not replace:
            raise ValueError(f"tool '{spec.name}' already registered (pass replace=True)")
        self._tools[spec.name] = spec

    def get(self, name: str) -> Optional[ToolSpec]:
        return self._tools.get(name)

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def names(self) -> List[str]:
        return sorted(self._tools)

    def specs(self) -> List[ToolSpec]:
        return [self._tools[n] for n in self.names()]

    def describe(self) -> List[Dict[str, Any]]:
        """Registry snapshot (for logs / the demo UI), no callables leaked."""
        return [
            {
                "name": s.name,
                "description": s.description,
                "available": s.available,
                "timeout_s": s.timeout_s,
                "source_type": s.source_type,
                "source_name": s.source_name,
                "supports_cached_mode": s.supports_cached_mode,
                "args_schema": s.args_schema,
            }
            for s in self.specs()
        ]


# ---------------------------------------------------------------------------
# Argument schemas for the merged tools
# ---------------------------------------------------------------------------

_MODE_PROPERTY = {
    "type": "string",
    "enum": ["live", "cached", "auto"],
    "description": "Data mode; omit for auto (env-driven USE_CACHED_EXTERNAL_DATA/NETWORK_MODE).",
}

WEATHER_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "get_weather arguments",
    "type": "object",
    "properties": {"mode": _MODE_PROPERTY},
    "additionalProperties": False,
}

ELEVATION_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "get_elevation arguments",
    "type": "object",
    "properties": {"mode": _MODE_PROPERTY},
    "additionalProperties": False,
}

_EDGE_RULE_SCHEMA = {
    "type": "object",
    "properties": {
        "edge_id": {"type": "string"},
        "road_id": {"type": "string"},
        "vehicle_types": {"type": "array", "items": {"type": "string"}},
        "allowed_vehicle_types": {"type": "array", "items": {"type": "string"}},
        "reason": {"type": "string"},
    },
    "additionalProperties": False,
    "anyOf": [{"required": ["edge_id"]}, {"required": ["road_id"]}],
}

ROUTING_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "compute_route arguments",
    "type": "object",
    "properties": {
        "vehicle_type": {
            "type": "string",
            "description": "ccf | light_vehicle | command_post | any (aliases accepted).",
        },
        "origin": {"type": "string", "minLength": 1},
        "destination": {"type": "string", "minLength": 1},
        "blocked_edges": {"type": "array", "items": _EDGE_RULE_SCHEMA},
        "restricted_edges": {"type": "array", "items": _EDGE_RULE_SCHEMA},
        "danger_polygons": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "polygon_id": {"type": "string"},
                    "coordinates": {
                        "type": "array",
                        "minItems": 3,
                        "items": {
                            "type": "array",
                            "items": {"type": "number"},
                            "minItems": 2,
                            "maxItems": 2,
                        },
                    },
                },
                "required": ["coordinates"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["origin", "destination"],
    "additionalProperties": False,
}

#: Interface-only stub schema — refined when each adapter is merged.
STUB_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
}


# ---------------------------------------------------------------------------
# Default registry wired on the merged adapters
# ---------------------------------------------------------------------------

def make_stub_spec(
    name: str,
    description: str,
    source_type: str,
    source_name: str,
    args_schema: Optional[Dict[str, Any]] = None,
) -> ToolSpec:
    """Allowlisted-but-unavailable tool: interface reserved, never executable."""
    return ToolSpec(
        name=name,
        description=description + " [adapter not merged yet — unavailable]",
        args_schema=args_schema or STUB_ARGS_SCHEMA,
        handler=None,
        timeout_s=DEFAULT_TIMEOUT_S,
        source_type=source_type,
        source_name=source_name,
        supports_cached_mode=False,
        available=False,
    )


def build_default_registry() -> ToolRegistry:
    """Registry wired on the real merged modules in tools/ (consumed as-is)."""
    # Static imports of vetted first-party adapters only — resolved here (not
    # at module import) so an import failure names the missing adapter clearly.
    from tools.elevation import adapter as elevation_adapter
    from tools.routing import router as routing_router
    from tools.weather import adapter as weather_adapter

    def _get_weather(mode: Optional[str] = None) -> Dict[str, Any]:
        return weather_adapter.get(mode=mode)

    def _get_elevation(mode: Optional[str] = None) -> Dict[str, Any]:
        return elevation_adapter.get(mode=mode)

    def _compute_route(**arguments: Any) -> Dict[str, Any]:
        return routing_router.compute_route(arguments)

    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="get_weather",
            description="Current weather (Open-Meteo) for the demo zone, with offline cache.",
            args_schema=WEATHER_ARGS_SCHEMA,
            handler=_get_weather,
            timeout_s=15.0,
            source_type="live_public",
            source_name=weather_adapter.SOURCE_NAME,
            supports_cached_mode=True,
        )
    )
    registry.register(
        ToolSpec(
            name="get_elevation",
            description="Elevation + local slope (Open-Meteo Elevation) for the demo zone, with offline cache.",
            args_schema=ELEVATION_ARGS_SCHEMA,
            handler=_get_elevation,
            timeout_s=15.0,
            source_type="live_public",
            source_name=elevation_adapter.SOURCE_NAME,
            supports_cached_mode=True,
        )
    )
    registry.register(
        ToolSpec(
            name="compute_route",
            description="Deterministic vehicle-aware routing over the seeded demo road graph.",
            args_schema=ROUTING_ARGS_SCHEMA,
            handler=_compute_route,
            timeout_s=5.0,
            source_type="seeded_demo",
            source_name=routing_router.SOURCE_NAME,
            supports_cached_mode=False,
        )
    )

    # Interface-only stubs for adapters not merged yet (#firms/#cadastre/#osm/#resources).
    for name, description, source_type, source_name in (
        ("get_firms", "NASA FIRMS active-fire detections for the demo bbox.", "live_public", "nasa-firms"),
        ("get_cadastre", "Cadastre parcels / building footprints for the demo zone.", "live_public", "cadastre-etalab"),
        ("get_osm", "OpenStreetMap features (roads, hydrants, buildings) for the demo bbox.", "live_public", "osm-overpass"),
        ("get_resources", "Seeded operational resources (units, water points, availability).", "seeded_demo", "resources-seed"),
    ):
        registry.register(make_stub_spec(name, description, source_type, source_name))

    return registry


# ---------------------------------------------------------------------------
# Full registry: every merged adapter wired (issue #52, first real E2E)
# ---------------------------------------------------------------------------

#: Feature-collection tools return thousands of geojson features (cadastre:
#: ~10k). The registry serves the model a deterministic digest (counts + a
#: bounded sample with geometry reduced to a centroid) so tool results fit in
#: the 8k-token Gemma context. Truncation is explicit in the payload.
MAX_DIGEST_FEATURES = 6

FIRMS_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "get_firms arguments",
    "type": "object",
    "properties": {"mode": _MODE_PROPERTY},
    "additionalProperties": False,
}

CADASTRE_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "get_cadastre arguments",
    "type": "object",
    "properties": {},
    "additionalProperties": False,
}

OSM_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "get_osm arguments",
    "type": "object",
    "properties": {
        "category": {
            "type": "string",
            "enum": ["road", "track", "water_point", "camping", "industrial", "critical_asset"],
            "description": "Optional single OSM category filter.",
        }
    },
    "additionalProperties": False,
}

RESOURCES_ARGS_SCHEMA: Dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "get_resources arguments",
    "type": "object",
    "properties": {
        "section": {
            "type": "string",
            "enum": ["units", "resources", "roads", "safety_rules"],
            "description": "Optional single section; omit for units + resources together.",
        }
    },
    "additionalProperties": False,
}


def _feature_centroid(geometry: Dict[str, Any]) -> Optional[List[float]]:
    """Mean [lon, lat] of every coordinate pair found in the geometry."""
    points: List[Tuple[float, float]] = []

    def walk(node: Any) -> None:
        if (
            isinstance(node, (list, tuple))
            and len(node) == 2
            and all(isinstance(v, (int, float)) for v in node)
        ):
            points.append((float(node[0]), float(node[1])))
        elif isinstance(node, (list, tuple)):
            for item in node:
                walk(item)

    walk(geometry.get("coordinates"))
    if not points:
        return None
    return [
        round(sum(p[0] for p in points) / len(points), 6),
        round(sum(p[1] for p in points) / len(points), 6),
    ]


def _digest_feature(feature: Dict[str, Any]) -> Dict[str, Any]:
    """One geojson feature reduced to properties + centroid (no full geometry)."""
    digest: Dict[str, Any] = {"properties": dict(feature.get("properties") or {})}
    geometry = feature.get("geometry")
    if isinstance(geometry, dict):
        centroid = _feature_centroid(geometry)
        if centroid is not None:
            digest["centroid_lon_lat"] = centroid
    return digest


def _digest_feature_result(result: Dict[str, Any], max_features: int = MAX_DIGEST_FEATURES) -> Dict[str, Any]:
    """Bound a ToolResult's data.features to a digest the LLM context can hold."""
    data = result.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        return result
    features = data["features"]
    digested = dict(data)
    digested["features"] = [_digest_feature(f) for f in features[:max_features]]
    digested["total_feature_count"] = len(features)
    if len(features) > max_features:
        digested["features_truncated_to"] = max_features
        digested["truncated_for_context"] = True
    result = dict(result)
    result["data"] = digested
    return result


def build_full_registry() -> ToolRegistry:
    """Default registry + the remaining merged adapters (firms/cadastre/osm/resources).

    Used by the real incident pipeline (issue #52): every allowlisted tool is
    executable. Feature-collection payloads are digested (see
    :data:`MAX_DIGEST_FEATURES`) so results stay LLM-context-sized; full raw
    data remains available through the adapters themselves.
    """
    from tools.cadastre import loader as cadastre_loader
    from tools.firms import adapter as firms_adapter
    from tools.osm import loader as osm_loader
    from tools.resources.store import get_store

    registry = build_default_registry()

    def _get_firms(mode: Optional[str] = None) -> Dict[str, Any]:
        return firms_adapter.get(mode=mode)

    def _get_cadastre() -> Dict[str, Any]:
        return _digest_feature_result(cadastre_loader.get())

    def _get_osm(category: Optional[str] = None) -> Dict[str, Any]:
        return _digest_feature_result(osm_loader.get(category=category))

    def _get_resources(section: Optional[str] = None) -> Dict[str, Any]:
        store = get_store()
        if section is not None:
            return store.get(section)
        units = store.get("units")
        resources = store.get("resources")
        # Raw payload: the executor wraps it with this spec's seeded_demo provenance.
        return {
            "units": (units.get("data") or {}).get("units", []),
            "resources": (resources.get("data") or {}).get("resources", []),
        }

    registry.register(
        ToolSpec(
            name="get_firms",
            description="NASA FIRMS satellite active-fire hotspot detections for the demo bbox (cached offline).",
            args_schema=FIRMS_ARGS_SCHEMA,
            handler=_get_firms,
            timeout_s=15.0,
            source_type="live_public",
            source_name=firms_adapter.SOURCE_NAME,
            supports_cached_mode=True,
        ),
        replace=True,
    )
    registry.register(
        ToolSpec(
            name="get_cadastre",
            description="Cadastral buildings near the incident (Etalab, pre-clipped local cache; digest of ~10k footprints).",
            args_schema=CADASTRE_ARGS_SCHEMA,
            handler=_get_cadastre,
            timeout_s=10.0,
            source_type="cached_public",
            source_name=cadastre_loader.SOURCE_NAME,
            supports_cached_mode=False,
        ),
        replace=True,
    )
    registry.register(
        ToolSpec(
            name="get_osm",
            description="OpenStreetMap features for the demo bbox: roads, tracks, water points, industrial, critical assets (local cache).",
            args_schema=OSM_ARGS_SCHEMA,
            handler=_get_osm,
            timeout_s=10.0,
            source_type="cached_public",
            source_name=osm_loader.SOURCE_NAME,
            supports_cached_mode=False,
        ),
        replace=True,
    )
    registry.register(
        ToolSpec(
            name="get_resources",
            description="Seeded scenario state: engaged units and operational resources (water points, reserves).",
            args_schema=RESOURCES_ARGS_SCHEMA,
            handler=_get_resources,
            timeout_s=5.0,
            source_type="seeded_demo",
            source_name="resources-seed",
            supports_cached_mode=False,
        ),
        replace=True,
    )
    return registry
