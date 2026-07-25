"""Deterministic vehicle-aware routing tool for the BLAZE wildfire demo.

Pure, self-contained module (stdlib + pydantic only). Routes over a small
seeded road graph (tools/routing/graph_data.json) whose coordinates are
consistent with data/scenario/roads.json and data/scenario/units.json
(zone ~43.45N / 3.75E).

Public API:
    compute_route(request, tool_call_id=None) -> dict  (ToolResult shape,
    see contracts/schemas/tool_result.schema.json, source_type="seeded_demo")

Algorithm: iterative Dijkstra. The unconstrained fastest path is computed
first; if it violates a constraint (vehicle blocked/restricted edge, danger
polygon crossing) it is recorded as a rejected route with a reason
("blocked_for_vehicle" | "danger_zone"), the violating edges are removed,
and Dijkstra runs again. This yields the fastest valid route plus every
faster-but-invalid alternative with its rejection reason. If no valid path
exists, a rejected entry with reason "no_path" is returned.
"""

from __future__ import annotations

import heapq
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from pydantic import BaseModel, Field, field_validator

TOOL_NAME = "routing.compute_route"
SOURCE_TYPE = "seeded_demo"
SOURCE_NAME = "routing-graph"

GRAPH_DATA_PATH = Path(__file__).resolve().parent / "graph_data.json"

ALL_VEHICLE_TYPES = ("CCF", "light_vehicle", "command_post")

VEHICLE_ALIASES = {
    "ccf": "CCF",
    "light": "light_vehicle",
    "light_vehicle": "light_vehicle",
    "lv": "light_vehicle",
    "command_post": "command_post",
    "cp": "command_post",
    "any": "any",
    "all": "any",
}

REASON_BLOCKED = "blocked_for_vehicle"
REASON_DANGER = "danger_zone"
REASON_NO_PATH = "no_path"

_MAX_ROUTE_ATTEMPTS = 25


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------

class EdgeRule(BaseModel):
    """A blocked or restricted edge/road.

    Match by ``edge_id`` or ``road_id`` (at least one required).
    For blocked entries, ``vehicle_types`` lists the vehicle types the edge is
    blocked for (omitted/empty = blocked for all vehicles).
    For restricted entries, ``allowed_vehicle_types`` replaces the edge's base
    allowed list (e.g. D17 restricted to ["light_vehicle"]).
    """

    edge_id: Optional[str] = None
    road_id: Optional[str] = None
    vehicle_types: Optional[List[str]] = None
    allowed_vehicle_types: Optional[List[str]] = None
    reason: Optional[str] = None

    def matches(self, edge: "Edge") -> bool:
        if self.edge_id and _norm_key(self.edge_id) == _norm_key(edge.edge_id):
            return True
        if self.road_id and _norm_key(self.road_id) == _norm_key(edge.road_id):
            return True
        return False


class DangerPolygon(BaseModel):
    polygon_id: str = "danger-polygon"
    coordinates: List[List[float]] = Field(
        ..., description="Polygon ring as [[lat, lon], ...] (auto-closed)."
    )

    @field_validator("coordinates")
    @classmethod
    def _at_least_triangle(cls, v: List[List[float]]) -> List[List[float]]:
        if len(v) < 3:
            raise ValueError("danger polygon needs at least 3 vertices")
        for pt in v:
            if len(pt) != 2:
                raise ValueError("each polygon vertex must be [lat, lon]")
        return v


class RouteRequest(BaseModel):
    vehicle_type: str = "any"
    origin: str
    destination: str
    blocked_edges: List[EdgeRule] = Field(default_factory=list)
    restricted_edges: List[EdgeRule] = Field(default_factory=list)
    danger_polygons: List[DangerPolygon] = Field(default_factory=list)

    @field_validator("danger_polygons", mode="before")
    @classmethod
    def _coerce_polygons(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return v
        coerced = []
        for i, item in enumerate(v):
            if isinstance(item, dict):
                coords = (
                    item.get("coordinates")
                    or item.get("polygon")
                    or item.get("points")
                )
                coerced.append(
                    {
                        "polygon_id": item.get("polygon_id")
                        or item.get("id")
                        or f"danger-polygon-{i + 1}",
                        "coordinates": coords,
                    }
                )
            elif isinstance(item, (list, tuple)):
                coerced.append(
                    {"polygon_id": f"danger-polygon-{i + 1}", "coordinates": item}
                )
            else:
                coerced.append(item)
        return coerced


# ---------------------------------------------------------------------------
# Graph loading
# ---------------------------------------------------------------------------

class Node(BaseModel):
    node_id: str
    name: str
    lat: float
    lon: float


class Edge(BaseModel):
    edge_id: str
    road_id: str
    road_name: str
    road_type: str
    from_node: str
    to_node: str
    speed_kmh: float
    allowed_vehicle_types: List[str]

    length_km: float = 0.0  # filled at load time


class Graph(BaseModel):
    nodes: Dict[str, Node]
    edges: Dict[str, Edge]
    aliases: Dict[str, str]
    adjacency: Dict[str, List[Tuple[str, str]]]  # node -> [(edge_id, other_node)]


def _norm_key(value: str) -> str:
    return value.strip().lower().replace(" ", "-").replace("_", "-")


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def load_graph(path: Path = GRAPH_DATA_PATH) -> Graph:
    raw = json.loads(path.read_text(encoding="utf-8"))
    nodes = {n["node_id"]: Node(**n) for n in raw["nodes"]}
    edges: Dict[str, Edge] = {}
    adjacency: Dict[str, List[Tuple[str, str]]] = {nid: [] for nid in nodes}
    for e in raw["edges"]:
        edge = Edge(**{k: v for k, v in e.items() if k in Edge.model_fields})
        a, b = nodes[edge.from_node], nodes[edge.to_node]
        edge.length_km = _haversine_km(a.lat, a.lon, b.lat, b.lon)
        edges[edge.edge_id] = edge
        adjacency[edge.from_node].append((edge.edge_id, edge.to_node))
        adjacency[edge.to_node].append((edge.edge_id, edge.from_node))
    for nid in adjacency:  # deterministic neighbor order
        adjacency[nid].sort()
    aliases = {_norm_key(k): v for k, v in raw.get("aliases", {}).items()}
    return Graph(nodes=nodes, edges=edges, aliases=aliases, adjacency=adjacency)


_GRAPH: Optional[Graph] = None


def get_graph() -> Graph:
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = load_graph()
    return _GRAPH


def resolve_node(graph: Graph, label: str) -> Optional[str]:
    key = _norm_key(label)
    if key in graph.nodes:
        return key
    if key in graph.aliases:
        return graph.aliases[key]
    # also allow "-pos" shorthand and node names ("Water Point 2")
    for nid, node in graph.nodes.items():
        if _norm_key(node.name) == key:
            return nid
    return None


# ---------------------------------------------------------------------------
# Geometry helpers (danger polygons)
# ---------------------------------------------------------------------------

Point = Tuple[float, float]  # (lat, lon)


def _point_in_polygon(pt: Point, polygon: Sequence[Point]) -> bool:
    lat, lon = pt
    inside = False
    n = len(polygon)
    for i in range(n):
        lat1, lon1 = polygon[i]
        lat2, lon2 = polygon[(i + 1) % n]
        if (lon1 > lon) != (lon2 > lon):
            t = (lon - lon1) / (lon2 - lon1)
            if lat < lat1 + t * (lat2 - lat1):
                inside = not inside
    return inside


def _orient(p: Point, q: Point, r: Point) -> float:
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])


def _on_segment(p: Point, q: Point, r: Point) -> bool:
    return (
        min(p[0], r[0]) - 1e-12 <= q[0] <= max(p[0], r[0]) + 1e-12
        and min(p[1], r[1]) - 1e-12 <= q[1] <= max(p[1], r[1]) + 1e-12
    )


def _segments_intersect(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    o1, o2 = _orient(p1, p2, q1), _orient(p1, p2, q2)
    o3, o4 = _orient(q1, q2, p1), _orient(q1, q2, p2)
    if ((o1 > 0) != (o2 > 0)) and ((o3 > 0) != (o4 > 0)):
        return True
    if abs(o1) < 1e-18 and _on_segment(p1, q1, p2):
        return True
    if abs(o2) < 1e-18 and _on_segment(p1, q2, p2):
        return True
    if abs(o3) < 1e-18 and _on_segment(q1, p1, q2):
        return True
    if abs(o4) < 1e-18 and _on_segment(q1, p2, q2):
        return True
    return False


def _segment_hits_polygon(a: Point, b: Point, polygon: Sequence[Point]) -> bool:
    if _point_in_polygon(a, polygon) or _point_in_polygon(b, polygon):
        return True
    n = len(polygon)
    for i in range(n):
        if _segments_intersect(a, b, polygon[i], polygon[(i + 1) % n]):
            return True
    return False


def edge_hits_polygon(graph: Graph, edge: Edge, polygon: DangerPolygon) -> bool:
    a = graph.nodes[edge.from_node]
    b = graph.nodes[edge.to_node]
    ring = [(p[0], p[1]) for p in polygon.coordinates]
    return _segment_hits_polygon((a.lat, a.lon), (b.lat, b.lon), ring)


# ---------------------------------------------------------------------------
# Constraint checks
# ---------------------------------------------------------------------------

def normalize_vehicle(vehicle_type: str) -> Optional[str]:
    return VEHICLE_ALIASES.get(vehicle_type.strip().lower())


def edge_violation(
    graph: Graph,
    edge: Edge,
    vehicle: str,
    blocked: List[EdgeRule],
    restricted: List[EdgeRule],
    polygons: List[DangerPolygon],
) -> Optional[Dict[str, str]]:
    """Return the first violation for this edge, or None if traversable."""
    # 1. Explicit blocks (apply to "any" only when blocked for all types).
    for rule in blocked:
        if not rule.matches(edge):
            continue
        types = rule.vehicle_types or list(ALL_VEHICLE_TYPES)
        blocked_for_any = set(ALL_VEHICLE_TYPES) <= set(types)
        if (vehicle == "any" and blocked_for_any) or (vehicle != "any" and vehicle in types):
            return {
                "reason": REASON_BLOCKED,
                "detail": rule.reason
                or f"{edge.road_name} ({edge.edge_id}) is blocked for vehicle type '{vehicle}'",
            }
    # 2. Allowed vehicle types (restricted_edges override the base list).
    allowed = edge.allowed_vehicle_types
    for rule in restricted:
        if rule.matches(edge) and rule.allowed_vehicle_types is not None:
            allowed = rule.allowed_vehicle_types
    if vehicle != "any" and vehicle not in allowed:
        return {
            "reason": REASON_BLOCKED,
            "detail": (
                f"{edge.road_name} ({edge.edge_id}) allows {allowed}, "
                f"not vehicle type '{vehicle}'"
            ),
        }
    # 3. Danger polygons.
    for poly in polygons:
        if edge_hits_polygon(graph, edge, poly):
            return {
                "reason": REASON_DANGER,
                "detail": (
                    f"{edge.road_name} ({edge.edge_id}) crosses danger zone "
                    f"'{poly.polygon_id}'"
                ),
            }
    return None


# ---------------------------------------------------------------------------
# Dijkstra
# ---------------------------------------------------------------------------

def _edge_time_min(edge: Edge) -> float:
    return edge.length_km / edge.speed_kmh * 60.0


def dijkstra(
    graph: Graph, origin: str, destination: str, removed_edges: set
) -> Optional[List[str]]:
    """Fastest path by travel time. Returns ordered edge_id list or None."""
    dist: Dict[str, float] = {origin: 0.0}
    prev: Dict[str, Tuple[str, str]] = {}  # node -> (prev_node, edge_id)
    visited: set = set()
    heap: List[Tuple[float, str]] = [(0.0, origin)]
    while heap:
        d, node = heapq.heappop(heap)
        if node in visited:
            continue
        visited.add(node)
        if node == destination:
            break
        for edge_id, other in graph.adjacency[node]:
            if edge_id in removed_edges or other in visited:
                continue
            nd = d + _edge_time_min(graph.edges[edge_id])
            if nd < dist.get(other, math.inf) - 1e-12:
                dist[other] = nd
                prev[other] = (node, edge_id)
                heapq.heappush(heap, (nd, other))
    if destination not in visited:
        return None
    path: List[str] = []
    node = destination
    while node != origin:
        pnode, edge_id = prev[node]
        path.append(edge_id)
        node = pnode
    path.reverse()
    return path


# ---------------------------------------------------------------------------
# Route assembly
# ---------------------------------------------------------------------------

def _route_geometry(graph: Graph, origin: str, edge_ids: List[str]) -> List[Dict[str, float]]:
    coords: List[Dict[str, float]] = []
    node = origin
    coords.append({"lat": graph.nodes[node].lat, "lon": graph.nodes[node].lon})
    for edge_id in edge_ids:
        edge = graph.edges[edge_id]
        node = edge.to_node if edge.from_node == node else edge.from_node
        coords.append({"lat": graph.nodes[node].lat, "lon": graph.nodes[node].lon})
    return coords


def _describe_route(
    graph: Graph, route_id: str, origin: str, edge_ids: List[str]
) -> Dict[str, Any]:
    edges_out: List[Dict[str, Any]] = []
    node = origin
    total_km = 0.0
    total_min = 0.0
    for edge_id in edge_ids:
        edge = graph.edges[edge_id]
        nxt = edge.to_node if edge.from_node == node else edge.from_node
        edges_out.append(
            {
                "edge_id": edge.edge_id,
                "road_id": edge.road_id,
                "road_name": edge.road_name,
                "from_node": node,
                "to_node": nxt,
                "distance_km": round(edge.length_km, 3),
                "travel_time_min": round(_edge_time_min(edge), 2),
            }
        )
        total_km += edge.length_km
        total_min += _edge_time_min(edge)
        node = nxt
    roads: List[str] = []
    for e in edges_out:
        if e["road_id"] not in roads:
            roads.append(e["road_id"])
    return {
        "route_id": route_id,
        "edges": edges_out,
        "roads": roads,
        "geometry": _route_geometry(graph, origin, edge_ids),
        "distance_km": round(total_km, 3),
        "travel_time_min": round(total_min, 2),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _tool_result(
    tool_call_id: str,
    status: str,
    data: Optional[Dict[str, Any]],
    error: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "tool_call_id": tool_call_id,
        "tool_name": TOOL_NAME,
        "status": status,
        "data": data,
        "source_type": SOURCE_TYPE,
        "source_name": SOURCE_NAME,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "data_timestamp": None,
        "is_cached": False,
        "staleness_seconds": None,
        "error": error,
    }


def compute_route(
    request: "RouteRequest | Dict[str, Any]",
    tool_call_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Pure routing function. Returns a ToolResult dict (source_type seeded_demo)."""
    tool_call_id = tool_call_id or f"routing-{uuid.uuid4().hex[:12]}"
    try:
        req = request if isinstance(request, RouteRequest) else RouteRequest(**request)
    except Exception as exc:  # pydantic validation error
        return _tool_result(tool_call_id, "error", None, f"invalid request: {exc}")

    graph = get_graph()
    vehicle = normalize_vehicle(req.vehicle_type)
    if vehicle is None:
        return _tool_result(
            tool_call_id,
            "error",
            None,
            f"unknown vehicle_type '{req.vehicle_type}' (expected ccf|light|any)",
        )
    origin = resolve_node(graph, req.origin)
    destination = resolve_node(graph, req.destination)
    if origin is None or destination is None:
        bad = req.origin if origin is None else req.destination
        return _tool_result(tool_call_id, "error", None, f"unknown location '{bad}'")
    if origin == destination:
        return _tool_result(
            tool_call_id, "error", None, "origin and destination are the same node"
        )

    rejected: List[Dict[str, Any]] = []
    selected: Optional[Dict[str, Any]] = None
    removed: set = set()
    route_idx = 0
    for _ in range(_MAX_ROUTE_ATTEMPTS):
        path = dijkstra(graph, origin, destination, removed)
        if path is None:
            break
        route_idx += 1
        violations = []
        for edge_id in path:
            v = edge_violation(
                graph,
                graph.edges[edge_id],
                vehicle,
                req.blocked_edges,
                req.restricted_edges,
                req.danger_polygons,
            )
            if v is not None:
                violations.append({"edge_id": edge_id, **v})
        route = _describe_route(graph, f"route-{route_idx}", origin, path)
        if not violations:
            route["vehicle_compatible"] = True
            selected = route
            break
        route["vehicle_compatible"] = all(
            v["reason"] != REASON_BLOCKED for v in violations
        )
        route["reason"] = violations[0]["reason"]
        route["detail"] = violations[0]["detail"]
        route["violations"] = violations
        rejected.append(route)
        removed.update(v["edge_id"] for v in violations)

    if selected is None:
        rejected.append(
            {
                "route_id": f"route-{route_idx + 1}",
                "reason": REASON_NO_PATH,
                "detail": (
                    f"no traversable path from '{origin}' to '{destination}' "
                    f"for vehicle type '{vehicle}' under current constraints"
                ),
                "edges": [],
                "roads": [],
                "geometry": [],
                "vehicle_compatible": False,
            }
        )

    data = {
        "origin": origin,
        "destination": destination,
        "vehicle_type": vehicle,
        "selected_route": selected,
        "rejected_routes": rejected,
        "travel_time_min": selected["travel_time_min"] if selected else None,
        "distance_km": selected["distance_km"] if selected else None,
        "vehicle_compatibility": {
            "vehicle_type": vehicle,
            "route_found": selected is not None,
            "compatible": selected is not None,
        },
    }
    return _tool_result(tool_call_id, "success", data)


if __name__ == "__main__":
    result = compute_route(
        {
            "vehicle_type": "ccf",
            "origin": "alpha-3",
            "destination": "water-point-2",
            "blocked_edges": [{"road_id": "d17", "vehicle_types": ["CCF"]}],
        }
    )
    print(json.dumps(result, indent=2))
