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

from dataclasses import dataclass, field
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
