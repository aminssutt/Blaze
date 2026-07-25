"""BLAZE Agent 2 — Situation Context (issue #15).

``SituationContextAgent(client, tool_executor)`` works in two phases:

1. :meth:`select_tools` — Gemma decides which territorial tools to call (with an
   explicit reason per call) via ``chat_structured``. A **deterministic guard**
   then filters every tool name that is not in the catalogue (logged, never
   executed) and enforces a hard budget of ``max_tool_calls`` per turn. Accepted
   calls become contract-valid ToolRequest envelopes
   (``contracts/schemas/tool_request.schema.json``).
2. :meth:`execute_tools` runs the requests through the injected ``tool_executor``
   (duck-typed: anything exposing ``execute(tool_request) -> tool_result``, e.g.
   ``backend.orchestrator.tool_executor.ToolExecutor``), then
   :meth:`build_snapshot` synthesizes one SituationSnapshot via
   ``chat_structured`` and applies **deterministic guardrails**:

   - ``provenance`` is REWRITTEN entirely from the real ToolResults / RadioEvents
     — the model cannot invent or falsify a ``source_type`` (a cached result
     claimed as ``live_public`` is corrected to ``cached_public``);
   - tool-backed sections with no successful backing ToolResult are reset to
     their empty value and flagged in ``missing_information``;
   - failed/timed-out tools are appended to ``missing_information``;
   - ``incident_id`` / ``version`` / ``radio_events`` / ``generated_at`` are set
     deterministically by the caller, never by the model;
   - the final snapshot is validated against
     ``contracts/schemas/situation_snapshot.schema.json`` (raises
     :class:`SnapshotContractError` otherwise).

The agent NEVER issues orders to units — it only describes the situation (see
``inference/prompts/situation_context.md``).
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Protocol, Sequence

from jsonschema import Draft7Validator, FormatChecker

logger = logging.getLogger("blaze.agents.situation_context")

AGENT_ID = "situation_context"
DEFAULT_MAX_TOOL_CALLS = 5

_REPO_ROOT = Path(__file__).resolve().parents[2]
PROMPT_PATH = _REPO_ROOT / "inference" / "prompts" / "situation_context.md"
TOOL_REQUEST_SCHEMA_PATH = _REPO_ROOT / "contracts" / "schemas" / "tool_request.schema.json"
TOOL_RESULT_SCHEMA_PATH = _REPO_ROOT / "contracts" / "schemas" / "tool_result.schema.json"
SNAPSHOT_SCHEMA_PATH = _REPO_ROOT / "contracts" / "schemas" / "situation_snapshot.schema.json"


class SnapshotContractError(ValueError):
    """The post-processed snapshot still violates situation_snapshot.schema.json."""


class ToolExecutorProtocol(Protocol):
    """Duck-typed executor interface (implemented by backend.orchestrator)."""

    def execute(self, request: Mapping[str, Any]) -> Mapping[str, Any]:  # pragma: no cover
        ...


# ---------------------------------------------------------------------------
# Tool catalogue
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CatalogTool:
    """One tool the agent is allowed to request."""

    name: str
    description: str
    arguments_hint: str = "{}"


#: Default catalogue (issue #15). Must mirror the executor allowlist in
#: production — pass a custom ``catalog`` built from the registry if the
#: executor uses different names.
DEFAULT_TOOL_CATALOG: tuple[CatalogTool, ...] = (
    CatalogTool(
        "get_weather",
        "Current weather for the demo zone: temperature, humidity, wind speed/direction/gusts, precipitation (Open-Meteo, offline cache fallback).",
        '{"mode": "auto|live|cached (optional)"}',
    ),
    CatalogTool(
        "get_elevation",
        "Elevation and local slope estimate around the incident (Open-Meteo Elevation, offline cache fallback).",
        '{"mode": "auto|live|cached (optional)"}',
    ),
    CatalogTool(
        "get_firms_hotspots",
        "NASA FIRMS satellite active-fire hotspot detections for the demo bounding box.",
        "{}",
    ),
    CatalogTool(
        "get_cadastre_buildings",
        "Cadastral buildings and parcels near the incident (cadastre-etalab).",
        "{}",
    ),
    CatalogTool(
        "get_osm_features",
        "OpenStreetMap features near the incident: roads, hydrants, campings, critical assets (Overpass).",
        "{}",
    ),
    CatalogTool(
        "compute_route",
        "Deterministic vehicle-aware route over the seeded demo road graph.",
        '{"origin": "node/alias", "destination": "node/alias", "vehicle_type": "ccf|light_vehicle|any"}',
    ),
    CatalogTool(
        "get_units_resources",
        "Seeded scenario state of engaged units and operational resources (water points, reserves).",
        "{}",
    ),
)


def catalog_from_registry(registry_description: Iterable[Mapping[str, Any]]) -> tuple[CatalogTool, ...]:
    """Build a catalogue from ``ToolRegistry.describe()`` (available tools only)."""
    return tuple(
        CatalogTool(
            name=str(entry["name"]),
            description=str(entry.get("description", "")),
            arguments_hint=json.dumps(entry.get("args_schema", {}).get("properties", {})),
        )
        for entry in registry_description
        if entry.get("available", True)
    )


# ---------------------------------------------------------------------------
# Structured-output schema for phase 1 (tool selection)
# ---------------------------------------------------------------------------

TOOL_SELECTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tool_calls": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tool_name": {"type": "string"},
                    "arguments": {"type": "object"},
                    "reason": {"type": "string", "minLength": 1},
                },
                "required": ["tool_name", "arguments", "reason"],
            },
        }
    },
    "required": ["tool_calls"],
}


# ---------------------------------------------------------------------------
# Deterministic mapping tool -> snapshot sections it can back
# ---------------------------------------------------------------------------

#: Snapshot sections that MUST be backed by tool data (not model imagination).
_OBJECT_SECTIONS = ("weather", "terrain")
_ARRAY_SECTIONS = (
    "fire_hotspots",
    "roads",
    "buildings_and_parcels",
    "critical_assets",
    "units",
    "resources",
)
TOOL_BACKED_SECTIONS = _OBJECT_SECTIONS + _ARRAY_SECTIONS

_TOOL_FIELD_MAP: dict[str, tuple[str, ...]] = {
    "get_weather": ("weather",),
    "weather": ("weather",),
    "get_elevation": ("terrain",),
    "elevation": ("terrain",),
    "get_firms_hotspots": ("fire_hotspots",),
    "get_firms": ("fire_hotspots",),
    "firms": ("fire_hotspots",),
    "get_cadastre_buildings": ("buildings_and_parcels",),
    "get_cadastre": ("buildings_and_parcels",),
    "cadastre": ("buildings_and_parcels",),
    "get_osm_features": ("critical_assets", "roads"),
    "get_osm": ("critical_assets", "roads"),
    "osm": ("critical_assets", "roads"),
    "compute_route": ("roads",),
    "routing": ("roads",),
    "routing.compute_route": ("roads",),
    "get_units_resources": ("units", "resources"),
    "get_resources": ("units", "resources"),
    "resources": ("units", "resources"),
}


def fields_for_tool(tool_name: str) -> tuple[str, ...]:
    """Snapshot sections a tool's result may back (empty tuple if unknown)."""
    return _TOOL_FIELD_MAP.get(str(tool_name).strip().lower(), ())


# ---------------------------------------------------------------------------
# Result containers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RejectedToolCall:
    """A model-proposed tool call discarded by the deterministic guard."""

    tool_name: str
    reason: str  # why it was rejected (not the model's reason)
    model_reason: str = ""


@dataclass(frozen=True)
class ToolSelection:
    """Outcome of phase 1: contract-valid requests + guard rejections."""

    requests: tuple[dict[str, Any], ...]
    rejected: tuple[RejectedToolCall, ...]


@dataclass(frozen=True)
class SituationContextRun:
    """Outcome of a full run: requests, rejections, results, final snapshot."""

    requests: tuple[dict[str, Any], ...]
    rejected: tuple[RejectedToolCall, ...]
    tool_results: tuple[dict[str, Any], ...]
    snapshot: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_schema(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _validator(schema: dict[str, Any]) -> Draft7Validator:
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema, format_checker=FormatChecker())


def _schema_errors(validator: Draft7Validator, instance: Any) -> list[str]:
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in errors
    ]


def _dedup_extend(target: list[str], items: Iterable[str]) -> None:
    for item in items:
        if item not in target:
            target.append(item)


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class SituationContextAgent:
    """Agent 2 — decides territorial tool calls, synthesizes SituationSnapshots.

    Parameters
    ----------
    client:
        A :class:`agents.common.inference_client.GemmaClient` (or anything with
        an async ``chat_structured(messages, schema=..., ...)`` method).
    tool_executor:
        Duck-typed executor with ``execute(tool_request) -> tool_result``
        (dict-shaped, per the frozen contracts). Injected — the agent never
        executes code itself.
    catalog:
        Allowed tool catalogue; defaults to :data:`DEFAULT_TOOL_CATALOG`.
    max_tool_calls:
        Hard per-turn budget enforced deterministically after model output.
    now_fn:
        Injectable clock (returns an ISO-8601 UTC string) for deterministic
        timestamps in tests.
    """

    def __init__(
        self,
        client: Any,
        tool_executor: ToolExecutorProtocol,
        *,
        catalog: Sequence[CatalogTool] = DEFAULT_TOOL_CATALOG,
        max_tool_calls: int = DEFAULT_MAX_TOOL_CALLS,
        prompt_path: Path | str | None = None,
        now_fn: Callable[[], str] | None = None,
    ) -> None:
        if max_tool_calls < 1:
            raise ValueError("max_tool_calls must be >= 1")
        self._client = client
        self._tool_executor = tool_executor
        self._catalog = tuple(catalog)
        self._catalog_names = {tool.name for tool in self._catalog}
        self._max_tool_calls = int(max_tool_calls)
        self._now = now_fn or _utcnow_iso

        path = Path(prompt_path) if prompt_path is not None else PROMPT_PATH
        self._system_prompt = self._render_prompt(path.read_text(encoding="utf-8"))

        self._request_validator = _validator(_load_schema(TOOL_REQUEST_SCHEMA_PATH))
        self._result_validator = _validator(_load_schema(TOOL_RESULT_SCHEMA_PATH))
        self._snapshot_schema = _load_schema(SNAPSHOT_SCHEMA_PATH)
        self._snapshot_validator = _validator(self._snapshot_schema)

    # -- phase 1: tool selection -------------------------------------------

    async def select_tools(
        self,
        incident_ctx: Mapping[str, Any],
        radio_events: Sequence[Mapping[str, Any]],
    ) -> ToolSelection:
        """Ask Gemma which tools to call, then apply the deterministic guard."""
        user_content = (
            "PHASE 1 — TOOL SELECTION.\n"
            "Decide which catalogue tools to call for this incident state and radio "
            "traffic. Give the operational reason for EACH call.\n\n"
            f"INCIDENT CONTEXT:\n{json.dumps(dict(incident_ctx), ensure_ascii=False, indent=2)}\n\n"
            f"RADIO EVENTS:\n{json.dumps([dict(e) for e in radio_events], ensure_ascii=False, indent=2)}\n\n"
            'Respond with ONLY {"tool_calls": [{"tool_name", "arguments", "reason"}, ...]}.'
        )
        result = await self._client.chat_structured(
            [
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": user_content},
            ],
            schema=TOOL_SELECTION_SCHEMA,
            schema_name="tool_selection",
            agent=AGENT_ID,
        )

        requests: list[dict[str, Any]] = []
        rejected: list[RejectedToolCall] = []
        for call in result.data.get("tool_calls", []):
            tool_name = str(call.get("tool_name", ""))
            model_reason = str(call.get("reason", ""))
            if tool_name not in self._catalog_names:
                logger.warning(
                    "Guard: discarding tool call '%s' — not in the catalogue (never executed).",
                    tool_name,
                )
                rejected.append(
                    RejectedToolCall(tool_name, "not_in_catalog", model_reason)
                )
                continue
            if len(requests) >= self._max_tool_calls:
                logger.warning(
                    "Guard: discarding tool call '%s' — per-turn budget of %d exceeded.",
                    tool_name,
                    self._max_tool_calls,
                )
                rejected.append(
                    RejectedToolCall(tool_name, "max_tool_calls_exceeded", model_reason)
                )
                continue
            arguments = call.get("arguments")
            if not isinstance(arguments, dict):
                rejected.append(
                    RejectedToolCall(tool_name, "arguments_not_an_object", model_reason)
                )
                continue
            request = {
                "tool_call_id": f"sitctx-{uuid.uuid4().hex[:12]}",
                "agent_id": AGENT_ID,
                "tool_name": tool_name,
                "arguments": arguments,
                "reason": model_reason,
                "requested_at": self._now(),
            }
            errors = _schema_errors(self._request_validator, request)
            if errors:  # pragma: no cover — envelope is built here, defensive only
                rejected.append(
                    RejectedToolCall(tool_name, f"contract_violation: {errors}", model_reason)
                )
                continue
            requests.append(request)
        return ToolSelection(requests=tuple(requests), rejected=tuple(rejected))

    # -- phase 2a: execution ------------------------------------------------

    def execute_tools(
        self, requests: Sequence[Mapping[str, Any]]
    ) -> tuple[dict[str, Any], ...]:
        """Run each ToolRequest through the injected executor (never locally).

        An executor exception or a non-contract-valid return value is converted
        into a structured ``error`` ToolResult so one bad tool never aborts the
        snapshot build.
        """
        results: list[dict[str, Any]] = []
        for request in requests:
            request = dict(request)
            try:
                raw = self._tool_executor.execute(request)
                result = dict(raw)
            except Exception as exc:  # noqa: BLE001 — isolate executor failures
                logger.warning(
                    "Tool executor raised for '%s': %s", request.get("tool_name"), exc
                )
                result = self._error_result(request, f"executor_exception: {exc}")
            errors = _schema_errors(self._result_validator, result)
            if errors:
                result = self._error_result(
                    request, f"tool_result_contract_violation: {'; '.join(errors)}"
                )
            results.append(result)
        return tuple(results)

    # -- phase 2b: snapshot synthesis ---------------------------------------

    async def build_snapshot(
        self,
        incident_ctx: Mapping[str, Any],
        radio_events: Sequence[Mapping[str, Any]],
        tool_results: Sequence[Mapping[str, Any]],
        *,
        version: int = 1,
        generated_at: str | None = None,
    ) -> dict[str, Any]:
        """Synthesize the SituationSnapshot, then enforce deterministic guardrails."""
        user_content = (
            "PHASE 2 — SNAPSHOT SYNTHESIS.\n"
            "Synthesize ONE SituationSnapshot from the ToolResults and RadioEvents "
            "below. Use only these inputs; never invent data.\n\n"
            f"INCIDENT CONTEXT:\n{json.dumps(dict(incident_ctx), ensure_ascii=False, indent=2)}\n\n"
            f"RADIO EVENTS:\n{json.dumps([dict(e) for e in radio_events], ensure_ascii=False, indent=2)}\n\n"
            f"TOOL RESULTS:\n{json.dumps([dict(r) for r in tool_results], ensure_ascii=False, indent=2)}\n\n"
            "Respond with ONLY the SituationSnapshot JSON object."
        )
        result = await self._client.chat_structured(
            [
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": user_content},
            ],
            schema=self._snapshot_schema,
            schema_name="situation_snapshot",
            agent=AGENT_ID,
        )
        snapshot = dict(result.data)
        return self._enforce_guardrails(
            snapshot,
            incident_ctx,
            radio_events,
            tool_results,
            version=version,
            generated_at=generated_at,
        )

    async def run(
        self,
        incident_ctx: Mapping[str, Any],
        radio_events: Sequence[Mapping[str, Any]],
        *,
        version: int = 1,
        generated_at: str | None = None,
    ) -> SituationContextRun:
        """Full turn: select tools -> execute -> synthesize + guard the snapshot."""
        selection = await self.select_tools(incident_ctx, radio_events)
        tool_results = self.execute_tools(selection.requests)
        snapshot = await self.build_snapshot(
            incident_ctx,
            radio_events,
            tool_results,
            version=version,
            generated_at=generated_at,
        )
        return SituationContextRun(
            requests=selection.requests,
            rejected=selection.rejected,
            tool_results=tool_results,
            snapshot=snapshot,
        )

    # -- deterministic guardrails ------------------------------------------

    def _enforce_guardrails(
        self,
        snapshot: dict[str, Any],
        incident_ctx: Mapping[str, Any],
        radio_events: Sequence[Mapping[str, Any]],
        tool_results: Sequence[Mapping[str, Any]],
        *,
        version: int,
        generated_at: str | None,
    ) -> dict[str, Any]:
        # 1. Deterministic identity fields — never model-controlled.
        snapshot["incident_id"] = str(
            incident_ctx.get("incident_id", snapshot.get("incident_id", "unknown-incident"))
        )
        snapshot["version"] = int(version)
        snapshot["generated_at"] = generated_at or self._now()
        snapshot["radio_events"] = [
            str(event.get("event_id", "")) for event in radio_events if event.get("event_id")
        ]

        # 2. Which sections are actually backed by a successful ToolResult?
        backing: dict[str, list[Mapping[str, Any]]] = {}
        failed_tools: list[Mapping[str, Any]] = []
        for result in tool_results:
            if result.get("status") in ("success", "fallback"):
                for section in fields_for_tool(result.get("tool_name", "")):
                    backing.setdefault(section, []).append(result)
            else:
                failed_tools.append(result)

        missing: list[str] = [
            str(item) for item in (snapshot.get("missing_information") or [])
        ]

        # 3. Reset tool-backed sections the model filled without real backing.
        for section in TOOL_BACKED_SECTIONS:
            empty: Any = None if section in _OBJECT_SECTIONS else []
            if section in backing:
                snapshot.setdefault(section, empty)
                continue
            current = snapshot.get(section)
            if current not in (None, [], {}):
                logger.warning(
                    "Guard: resetting unbacked snapshot section '%s' (no successful "
                    "ToolResult backs it — model data discarded).",
                    section,
                )
                _dedup_extend(
                    missing,
                    [f"No tool data available for '{section}' (unbacked model content discarded)."],
                )
            snapshot[section] = empty

        # 4. Failed tools are missing information by definition.
        for result in failed_tools:
            tool_name = str(result.get("tool_name", "unknown-tool"))
            status = str(result.get("status", "error"))
            error = str(result.get("error") or "no data returned")
            sections = fields_for_tool(tool_name)
            suffix = f" (affects: {', '.join(sections)})" if sections else ""
            _dedup_extend(
                missing, [f"Tool '{tool_name}' failed ({status}): {error}{suffix}"]
            )
        snapshot["missing_information"] = missing

        # 5. Provenance: rebuilt ENTIRELY from real inputs. Model provenance is
        #    discarded — a lying source_type cannot survive this step.
        provenance: list[dict[str, Any]] = []
        for section in TOOL_BACKED_SECTIONS:
            for result in backing.get(section, ()):
                source_type = str(result.get("source_type", "model_inference"))
                if result.get("is_cached") and source_type == "live_public":
                    source_type = "cached_public"
                entry: dict[str, Any] = {
                    "field": section,
                    "source_type": source_type,
                    "source_name": str(result.get("source_name", "unknown")),
                    "retrieved_at": str(result.get("retrieved_at", self._now())),
                    "is_cached": bool(result.get("is_cached", False)),
                }
                if result.get("data_timestamp") is not None:
                    entry["data_timestamp"] = result["data_timestamp"]
                if result.get("staleness_seconds") is not None:
                    entry["staleness_seconds"] = result["staleness_seconds"]
                provenance.append(entry)
        if radio_events:
            observed = [
                str(e["observed_at"]) for e in radio_events if e.get("observed_at")
            ]
            entry = {
                "field": "radio_events",
                "source_type": "human_report",
                "source_name": "radio-events",
            }
            if observed:
                entry["retrieved_at"] = max(observed)
            provenance.append(entry)
        for section in ("known_facts", "uncertain_facts", "conflicts", "missing_information"):
            provenance.append(
                {
                    "field": section,
                    "source_type": "model_inference",
                    "source_name": "situation-context-agent",
                    "retrieved_at": snapshot["generated_at"],
                }
            )
        snapshot["provenance"] = provenance

        # 6. Synthesis lists: coerce to lists of strings, preserve content.
        for section in ("known_facts", "uncertain_facts", "conflicts"):
            snapshot[section] = [str(item) for item in (snapshot.get(section) or [])]

        # 7. Final contract validation.
        errors = _schema_errors(self._snapshot_validator, snapshot)
        if errors:
            raise SnapshotContractError(
                f"post-processed snapshot violates contract: {'; '.join(errors)}"
            )
        return snapshot

    # -- internals ----------------------------------------------------------

    def _render_prompt(self, template: str) -> str:
        lines = [
            f"- `{tool.name}` — {tool.description} Arguments: `{tool.arguments_hint}`"
            for tool in self._catalog
        ]
        return template.replace("{{TOOL_CATALOG}}", "\n".join(lines)).replace(
            "{{MAX_TOOL_CALLS}}", str(self._max_tool_calls)
        )

    def _error_result(self, request: Mapping[str, Any], error: str) -> dict[str, Any]:
        return {
            "tool_call_id": str(request.get("tool_call_id", "unknown")),
            "tool_name": str(request.get("tool_name", "unknown")),
            "status": "error",
            "data": None,
            "source_type": "model_inference",
            "source_name": "situation-context-agent",
            "retrieved_at": self._now(),
            "data_timestamp": None,
            "is_cached": False,
            "staleness_seconds": None,
            "error": error,
        }
