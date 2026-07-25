"""Tests for the deterministic tool execution layer (issue #26).

Run from the repo root (no network needed — USE_CACHED_EXTERNAL_DATA=true):

    python -m pytest backend/orchestrator/tests -v
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from jsonschema import Draft7Validator, FormatChecker

from backend.orchestrator.tool_executor import (
    TOOL_REQUEST_SCHEMA_PATH,
    TOOL_RESULT_SCHEMA_PATH,
    ToolAuditLog,
    ToolExecutor,
    ToolRequestContractError,
)
from backend.orchestrator.tool_registry import (
    ToolRegistry,
    ToolSpec,
    build_default_registry,
)

REQUEST_VALIDATOR = Draft7Validator(
    json.loads(TOOL_REQUEST_SCHEMA_PATH.read_text(encoding="utf-8")),
    format_checker=FormatChecker(),
)
RESULT_VALIDATOR = Draft7Validator(
    json.loads(TOOL_RESULT_SCHEMA_PATH.read_text(encoding="utf-8")),
    format_checker=FormatChecker(),
)


def _request(tool_name: str, arguments: dict, agent_id: str = "situation_context") -> dict:
    return {
        "tool_call_id": f"test-{tool_name}-{int(time.time() * 1000)}",
        "agent_id": agent_id,
        "tool_name": tool_name,
        "arguments": arguments,
        "reason": "pytest",
        "requested_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _cached_style_result(tool_name: str) -> dict:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "tool_call_id": "internal",
        "tool_name": tool_name,
        "status": "success",
        "data": {"value": 42},
        "source_type": "cached_public",
        "source_name": f"{tool_name}-cache",
        "retrieved_at": now,
        "data_timestamp": None,
        "is_cached": True,
        "staleness_seconds": 120.0,
        "error": None,
    }


@pytest.fixture()
def executor(monkeypatch: pytest.MonkeyPatch) -> ToolExecutor:
    # Demo/offline mode: adapters must serve the committed cache, never the network.
    monkeypatch.setenv("USE_CACHED_EXTERNAL_DATA", "true")
    return ToolExecutor()


# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------

def test_registered_tools_and_statuses(executor: ToolExecutor) -> None:
    by_name = {s.name: s for s in executor.registry.specs()}
    assert set(by_name) == {
        "get_weather",
        "get_elevation",
        "compute_route",
        "get_firms",
        "get_cadastre",
        "get_osm",
        "get_resources",
    }
    for name in ("get_weather", "get_elevation", "compute_route"):
        assert by_name[name].available, name
    for name in ("get_firms", "get_cadastre", "get_osm", "get_resources"):
        assert not by_name[name].available, name
        assert by_name[name].handler is None


def test_unknown_tool_is_rejected_never_executed(executor: ToolExecutor) -> None:
    request = _request("os.system", {"cmd": "rm -rf /"})
    result = executor.execute(request)
    assert result["status"] == "error"
    assert result["error"].startswith("tool_not_allowlisted")
    assert result["data"] is None
    assert result["tool_call_id"] == request["tool_call_id"]
    # The rejection is still a contract-valid, audited pair.
    assert len(executor.audit_log) == 1


def test_unavailable_stub_is_rejected_never_executed(executor: ToolExecutor) -> None:
    result = executor.execute(_request("get_firms", {}))
    assert result["status"] == "error"
    assert result["error"].startswith("tool_unavailable")
    assert result["data"] is None


def test_malformed_request_envelope_raises_and_runs_nothing(executor: ToolExecutor) -> None:
    with pytest.raises(ToolRequestContractError):
        executor.execute({"tool_name": "get_weather", "arguments": {}})  # missing required keys
    assert len(executor.audit_log) == 0


# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------

def test_invalid_arguments_rejected_with_jsonschema_detail(executor: ToolExecutor) -> None:
    result = executor.execute(_request("compute_route", {"origin": "alpha-3"}))
    assert result["status"] == "error"
    assert result["error"].startswith("invalid_arguments")
    assert "'destination' is a required property" in result["error"]
    assert result["data"] is None


def test_unknown_argument_rejected_no_partial_execution(executor: ToolExecutor) -> None:
    result = executor.execute(_request("get_weather", {"mode": "cached", "shell": "bash"}))
    assert result["status"] == "error"
    assert result["error"].startswith("invalid_arguments")
    assert "shell" in result["error"]


# ---------------------------------------------------------------------------
# Timeout -> cache fallback
# ---------------------------------------------------------------------------

def _slow_tool_registry(supports_cached_mode: bool, calls: list) -> ToolRegistry:
    def slow_tool(mode: str | None = None) -> dict:
        calls.append(mode)
        if mode == "cached":
            return _cached_style_result("slow_tool")
        time.sleep(1.5)  # far beyond the 0.2s timeout
        return _cached_style_result("slow_tool")

    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="slow_tool",
            description="deliberately slow tool for timeout tests",
            args_schema={"type": "object", "properties": {"mode": {"type": "string"}}},
            handler=slow_tool,
            timeout_s=0.2,
            source_type="cached_public",
            source_name="slow-cache",
            supports_cached_mode=supports_cached_mode,
        )
    )
    return registry


def test_timeout_triggers_cached_fallback(executor: ToolExecutor) -> None:
    calls: list = []
    slow_executor = ToolExecutor(registry=_slow_tool_registry(True, calls))
    result = slow_executor.execute(_request("slow_tool", {}))
    assert calls[0] is None and "cached" in calls  # live attempt, then cache
    assert result["status"] == "fallback"
    assert result["is_cached"] is True
    assert result["staleness_seconds"] is not None
    assert "timeout after 0.2s" in result["error"]
    assert result["data"] == {"value": 42}


def test_timeout_without_cache_support_is_timeout_status(executor: ToolExecutor) -> None:
    calls: list = []
    slow_executor = ToolExecutor(registry=_slow_tool_registry(False, calls))
    result = slow_executor.execute(_request("slow_tool", {}))
    assert result["status"] == "timeout"
    assert calls == [None]  # never re-invoked with mode="cached"
    assert "no cached fallback" in result["error"]


# ---------------------------------------------------------------------------
# Real success paths (committed caches / seeded graph — zero network)
# ---------------------------------------------------------------------------

def test_weather_success_from_committed_cache_no_network(
    executor: ToolExecutor, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tools.weather import adapter as weather_adapter

    def _no_network(*args, **kwargs):  # pragma: no cover - guard
        raise AssertionError("network call attempted in cached mode")

    monkeypatch.setattr(weather_adapter.requests, "get", _no_network)

    request = _request("get_weather", {})
    result = executor.execute(request)
    assert result["status"] == "success"
    assert result["tool_name"] == "get_weather"
    assert result["tool_call_id"] == request["tool_call_id"]
    assert result["is_cached"] is True
    assert result["source_type"] == "cached_public"
    assert result["source_name"] == "open-meteo"
    assert result["staleness_seconds"] is not None and result["staleness_seconds"] >= 0
    assert isinstance(result["data"]["temperature_c"], (int, float))


def test_elevation_success_from_committed_cache_no_network(
    executor: ToolExecutor, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tools.elevation import adapter as elevation_adapter

    def _no_network(*args, **kwargs):  # pragma: no cover - guard
        raise AssertionError("network call attempted in cached mode")

    monkeypatch.setattr(elevation_adapter.requests, "get", _no_network)

    result = executor.execute(_request("get_elevation", {}))
    assert result["status"] == "success"
    assert result["is_cached"] is True
    assert result["source_type"] == "cached_public"
    assert "slope" in result["data"]


def test_routing_d17_blocked_for_ccf_reroutes_via_north_access(executor: ToolExecutor) -> None:
    request = _request(
        "compute_route",
        {
            "vehicle_type": "ccf",
            "origin": "alpha-3",
            "destination": "water-point-2",
            "blocked_edges": [
                {"road_id": "d17", "vehicle_types": ["CCF"], "reason": "D17 blocked for CCF"}
            ],
        },
        agent_id="tactical_planner",
    )
    result = executor.execute(request)
    assert result["status"] == "success"
    assert result["source_type"] == "seeded_demo"
    data = result["data"]
    selected = data["selected_route"]
    assert selected is not None
    assert "north-access" in selected["roads"]
    assert "d17" not in selected["roads"]
    # The faster-but-blocked D17 route must be reported with its reason.
    assert any(
        r.get("reason") == "blocked_for_vehicle"
        and any("d17" == e.get("road_id") for e in r.get("edges", []))
        for r in data["rejected_routes"]
    )


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

def test_audit_trail_every_pair_contract_valid_and_exports_jsonl(
    executor: ToolExecutor, tmp_path: Path
) -> None:
    executor.execute(_request("get_weather", {}))                     # success
    executor.execute(_request("compute_route", {"origin": "alpha-3"}))  # invalid args
    executor.execute(_request("nuke_it", {}))                         # not allowlisted
    executor.execute(_request("get_cadastre", {}))                    # unavailable stub

    entries = executor.audit_log.entries()
    assert len(entries) == 4
    for entry in entries:
        assert not list(REQUEST_VALIDATOR.iter_errors(entry["request"]))
        assert not list(RESULT_VALIDATOR.iter_errors(entry["result"]))
        assert entry["request"]["tool_call_id"] == entry["result"]["tool_call_id"]

    # Append-only from the outside: mutating a snapshot changes nothing.
    entries[0]["result"]["status"] = "tampered"
    assert executor.audit_log.entries()[0]["result"]["status"] != "tampered"

    out = executor.audit_log.export_jsonl(tmp_path / "audit.jsonl")
    lines = out.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 4
    for line in lines:
        pair = json.loads(line)
        assert not list(REQUEST_VALIDATOR.iter_errors(pair["request"]))
        assert not list(RESULT_VALIDATOR.iter_errors(pair["result"]))


def test_audit_log_refuses_contract_invalid_pairs() -> None:
    log = ToolAuditLog()
    with pytest.raises(ValueError, match="audit refused"):
        log.append({"tool_call_id": "x"}, _cached_style_result("t"))
    assert len(log) == 0
