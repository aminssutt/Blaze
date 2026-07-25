"""Tests for the Situation Context agent (issue #15).

Gemma is canned via respx (no GPU needed); the tool executor is a FAKE that
serves the REAL committed caches from ``data/cached_external/`` (weather: wind
12.8 km/h from 74° ENE, gusts 31.3 km/h) plus the real merged routing tool
(``tools/routing``). The deterministic guardrails are exercised against
adversarial canned model output (hallucinated tools, falsified provenance,
invented data sections).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import httpx
import pytest
import respx
from jsonschema import Draft7Validator, FormatChecker

from agents.common.inference_client import GemmaClient
from agents.situation_context.agent import (
    AGENT_ID,
    SituationContextAgent,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = REPO_ROOT / "data" / "cached_external"
SCENARIO_DIR = REPO_ROOT / "data" / "scenario"
SCHEMA_DIR = REPO_ROOT / "contracts" / "schemas"

VLLM_URL = "http://localhost:8000/v1/chat/completions"

TOOL_REQUEST_VALIDATOR = Draft7Validator(
    json.loads((SCHEMA_DIR / "tool_request.schema.json").read_text(encoding="utf-8")),
    format_checker=FormatChecker(),
)
SNAPSHOT_VALIDATOR = Draft7Validator(
    json.loads((SCHEMA_DIR / "situation_snapshot.schema.json").read_text(encoding="utf-8")),
    format_checker=FormatChecker(),
)

WEATHER_CACHE = json.loads(
    (CACHE_DIR / "openmeteo_weather_demo.json").read_text(encoding="utf-8")
)
ELEVATION_CACHE = json.loads(
    (CACHE_DIR / "openmeteo_elevation_demo.json").read_text(encoding="utf-8")
)


# ---------------------------------------------------------------------------
# Canned Gemma plumbing
# ---------------------------------------------------------------------------


def gemma_response(payload: object) -> httpx.Response:
    """OpenAI-compatible chat completion body whose content is `payload` as JSON."""
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "message": {"role": "assistant", "content": json.dumps(payload)},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 80, "total_tokens": 180},
        },
    )


# ---------------------------------------------------------------------------
# Fake tool executor serving the REAL committed caches + real routing
# ---------------------------------------------------------------------------


class FakeCacheToolExecutor:
    """Duck-typed executor: serves data/cached_external + the real routing tool."""

    def __init__(self, fail_tools: tuple[str, ...] = ()) -> None:
        self.fail_tools = set(fail_tools)
        self.executed: list[dict] = []

    def execute(self, request: dict) -> dict:
        self.executed.append(dict(request))
        name = request["tool_name"]
        if name in self.fail_tools:
            return self._error(request, f"tool_unavailable: '{name}' adapter not merged")
        if name == "get_weather":
            return self._from_cache("openmeteo_weather_demo.json", request)
        if name == "get_elevation":
            return self._from_cache("openmeteo_elevation_demo.json", request)
        if name == "get_firms_hotspots":
            return self._firms(request)
        if name == "get_units_resources":
            return self._units_resources(request)
        if name == "compute_route":
            return self._route(request)
        return self._error(request, f"tool_not_allowlisted: '{name}'")

    # -- canned-but-real payloads ------------------------------------------

    def _from_cache(self, filename: str, request: dict) -> dict:
        result = json.loads((CACHE_DIR / filename).read_text(encoding="utf-8"))
        # Served from the committed cache: cached, one hour stale. source_type
        # stays "live_public" as recorded at fetch time — the agent guard must
        # derive cached_public from is_cached, exactly like production caches.
        result.update(
            tool_call_id=request["tool_call_id"],
            tool_name=request["tool_name"],
            is_cached=True,
            staleness_seconds=3600.0,
        )
        return result

    def _firms(self, request: dict) -> dict:
        meta = json.loads(
            (CACHE_DIR / "firms_area_sample_occitanie.meta.json").read_text(encoding="utf-8")
        )
        with (CACHE_DIR / "firms_area_sample_occitanie.csv").open(encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        hotspots = [
            {
                "latitude": float(r["latitude"]),
                "longitude": float(r["longitude"]),
                "frp": float(r["frp"]),
                "acq_date": r["acq_date"],
                "satellite": r["satellite"],
            }
            for r in rows[:5]
        ]
        return {
            "tool_call_id": request["tool_call_id"],
            "tool_name": request["tool_name"],
            "status": "success",
            "data": {"hotspots": hotspots, "bbox_wsen": meta["bbox_wsen"]},
            "source_type": "live_public",
            "source_name": "nasa-firms",
            "retrieved_at": meta["fetched_at"],
            "data_timestamp": meta["fetched_at"],
            "is_cached": True,
            "staleness_seconds": 7200.0,
            "error": None,
        }

    def _units_resources(self, request: dict) -> dict:
        units = json.loads((SCENARIO_DIR / "units.json").read_text(encoding="utf-8"))
        resources = json.loads((SCENARIO_DIR / "resources.json").read_text(encoding="utf-8"))
        return {
            "tool_call_id": request["tool_call_id"],
            "tool_name": request["tool_name"],
            "status": "success",
            "data": {"units": units["units"], "resources": resources["resources"]},
            "source_type": "seeded_demo",
            "source_name": "scenario-seed",
            "retrieved_at": "2026-07-25T10:00:00+00:00",
            "data_timestamp": None,
            "is_cached": False,
            "staleness_seconds": None,
            "error": None,
        }

    def _route(self, request: dict) -> dict:
        from tools.routing import router  # real merged routing tool

        result = router.compute_route(dict(request["arguments"]))
        result["tool_call_id"] = request["tool_call_id"]
        result["tool_name"] = request["tool_name"]
        return result

    def _error(self, request: dict, error: str) -> dict:
        return {
            "tool_call_id": request["tool_call_id"],
            "tool_name": request["tool_name"],
            "status": "error",
            "data": None,
            "source_type": "live_public",
            "source_name": "fake-executor",
            "retrieved_at": "2026-07-25T10:00:00+00:00",
            "data_timestamp": None,
            "is_cached": False,
            "staleness_seconds": None,
            "error": error,
        }


class ExplodingExecutor:
    def execute(self, request: dict) -> dict:
        raise RuntimeError("boom: executor crashed")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def incident_ctx() -> dict:
    return {
        "incident_id": "incident-demo-01",
        "summary": "Vegetation fire reported near the hangar zone, spreading in wind.",
        "location": {"lat": 43.45, "lon": 3.75},
        "phase": "size_up",
    }


@pytest.fixture
def radio_events() -> list[dict]:
    return [
        {
            "event_id": "evt-001",
            "audio_id": "audio-001",
            "unit_id": "alpha-3",
            "event_type": "hazard_report",
            "location_reference": "hangar",
            "facts": ["Smoke column visible north of the hangar."],
            "urgency": "high",
            "confidence": 0.9,
            "confirmation_status": "reported",
            "is_correction": False,
            "corrects_event_id": None,
            "uncertainties": ["Fire front extent unknown."],
            "evidence_text": "Alpha 3, thick smoke north of the hangar.",
            "observed_at": "2026-07-25T09:55:00+00:00",
            "source_type": "human_report",
        },
        {
            "event_id": "evt-002",
            "audio_id": "audio-002",
            "unit_id": "bravo-2",
            "event_type": "wind_update",
            "location_reference": None,
            "facts": ["Wind picking up from the east."],
            "urgency": "medium",
            "confidence": 0.8,
            "confirmation_status": "reported",
            "is_correction": False,
            "corrects_event_id": None,
            "uncertainties": [],
            "evidence_text": "Bravo 2, wind is picking up from the east.",
            "observed_at": "2026-07-25T09:57:00+00:00",
            "source_type": "human_report",
        },
    ]


SELECTION_PAYLOAD = {
    "tool_calls": [
        {
            "tool_name": "get_weather",
            "arguments": {"mode": "auto"},
            "reason": "Wind update on radio — wind drives spread toward the hangar sector.",
        },
        {
            "tool_name": "get_elevation",
            "arguments": {},
            "reason": "Slope influences the spread rate around the incident.",
        },
        {
            "tool_name": "get_firms_hotspots",
            "arguments": {},
            "reason": "Confirm the reported smoke with satellite hotspot detections.",
        },
        {
            "tool_name": "get_units_resources",
            "arguments": {},
            "reason": "Need current unit water levels and available resources.",
        },
        {
            "tool_name": "compute_route",
            "arguments": {
                "origin": "command-post",
                "destination": "hangar-zone",
                "vehicle_type": "ccf",
            },
            "reason": "Verify CCF access from the command post to the hangar zone.",
        },
        {
            "tool_name": "launch_water_drop",  # hallucinated — MUST be discarded
            "arguments": {"target": "hangar"},
            "reason": "Request air support on the hangar.",
        },
    ]
}


def canned_snapshot(**overrides: object) -> dict:
    """Schema-valid snapshot as a (partly adversarial) model would emit it."""
    weather = WEATHER_CACHE["data"]
    snapshot = {
        "incident_id": "model-invented-incident",  # overridden by the guard
        "version": 99,  # overridden by the guard
        "radio_events": ["evt-invented"],  # overridden by the guard
        "weather": {
            "temperature_c": weather["temperature_c"],
            "relative_humidity_pct": weather["relative_humidity_pct"],
            "wind_speed_kmh": weather["wind_speed_kmh"],
            "wind_direction_deg": weather["wind_direction_deg"],
            "wind_gusts_kmh": weather["wind_gusts_kmh"],
        },
        "terrain": {
            "elevation_m": ELEVATION_CACHE["data"]["points"][0]["elevation_m"],
            "slope_pct": ELEVATION_CACHE["data"]["slope"]["slope_pct"],
        },
        "fire_hotspots": [{"latitude": 43.44343, "longitude": 4.88134, "frp": 1.2}],
        "roads": [{"road_id": "d17", "status": "open", "note": "route computed via D17"}],
        "buildings_and_parcels": [],
        "critical_assets": [],
        "units": [{"unit_id": "alpha-3", "status": "en_route", "water_pct": 65}],
        "resources": [{"resource_id": "water-point-2", "status": "available"}],
        "known_facts": [
            "Wind 12.8 km/h from ENE (74 deg), gusts 31.3 km/h.",
            "Smoke column reported north of the hangar by Alpha 3.",
        ],
        "uncertain_facts": ["Fire front extent unknown."],
        "conflicts": [],
        "missing_information": [],
        "provenance": [
            {  # deliberate LIE: cached weather claimed as live — must be corrected
                "field": "weather",
                "source_type": "live_public",
                "source_name": "open-meteo",
            }
        ],
        "generated_at": "2026-07-25T10:30:00+00:00",
    }
    snapshot.update(overrides)
    return snapshot


def make_agent(executor, **kwargs) -> tuple[GemmaClient, SituationContextAgent]:
    client = GemmaClient(agent=AGENT_ID)
    return client, SituationContextAgent(client, executor, **kwargs)


# ---------------------------------------------------------------------------
# Phase 1 — tool selection + deterministic guard
# ---------------------------------------------------------------------------


@respx.mock
async def test_select_tools_discards_hallucinated_tool(incident_ctx, radio_events):
    respx.post(VLLM_URL).mock(side_effect=[gemma_response(SELECTION_PAYLOAD)])
    executor = FakeCacheToolExecutor()
    client, agent = make_agent(executor)
    async with client:
        selection = await agent.select_tools(incident_ctx, radio_events)

    names = [r["tool_name"] for r in selection.requests]
    assert names == [
        "get_weather",
        "get_elevation",
        "get_firms_hotspots",
        "get_units_resources",
        "compute_route",
    ]
    # The hallucinated tool is rejected, logged, and NEVER executed.
    assert [r.tool_name for r in selection.rejected] == ["launch_water_drop"]
    assert selection.rejected[0].reason == "not_in_catalog"
    assert executor.executed == []

    for request in selection.requests:
        assert not list(TOOL_REQUEST_VALIDATOR.iter_errors(request))
        assert request["agent_id"] == "situation_context"
        assert request["reason"]  # the model's rationale is preserved


@respx.mock
async def test_select_tools_enforces_per_turn_budget(incident_ctx, radio_events):
    respx.post(VLLM_URL).mock(side_effect=[gemma_response(SELECTION_PAYLOAD)])
    client, agent = make_agent(FakeCacheToolExecutor(), max_tool_calls=2)
    async with client:
        selection = await agent.select_tools(incident_ctx, radio_events)

    assert len(selection.requests) == 2
    over_budget = [r for r in selection.rejected if r.reason == "max_tool_calls_exceeded"]
    assert len(over_budget) == 3  # 5 valid proposals - 2 budget
    assert {r.reason for r in selection.rejected} == {
        "max_tool_calls_exceeded",
        "not_in_catalog",
    }


# ---------------------------------------------------------------------------
# Full run — snapshot built from the REAL committed caches
# ---------------------------------------------------------------------------


@respx.mock
async def test_full_run_snapshot_valid_with_real_cached_data(incident_ctx, radio_events):
    respx.post(VLLM_URL).mock(
        side_effect=[gemma_response(SELECTION_PAYLOAD), gemma_response(canned_snapshot())]
    )
    executor = FakeCacheToolExecutor()
    client, agent = make_agent(executor)
    async with client:
        run = await agent.run(
            incident_ctx,
            radio_events,
            version=2,
            generated_at="2026-07-25T11:00:00+00:00",
        )

    snapshot = run.snapshot
    assert not list(SNAPSHOT_VALIDATOR.iter_errors(snapshot))

    # Identity fields are deterministic — model lies overridden.
    assert snapshot["incident_id"] == "incident-demo-01"
    assert snapshot["version"] == 2
    assert snapshot["generated_at"] == "2026-07-25T11:00:00+00:00"
    assert snapshot["radio_events"] == ["evt-001", "evt-002"]

    # Weather references the REAL committed cache: 12.8 km/h from 74° (ENE).
    assert snapshot["weather"]["wind_speed_kmh"] == WEATHER_CACHE["data"]["wind_speed_kmh"] == 12.8
    assert snapshot["weather"]["wind_direction_deg"] == 74
    assert snapshot["weather"]["wind_gusts_kmh"] == 31.3
    assert snapshot["weather"]["temperature_c"] == 24.9
    assert snapshot["weather"]["relative_humidity_pct"] == 87

    # The real routing tool ran against the seeded graph.
    route_results = [r for r in run.tool_results if r["tool_name"] == "compute_route"]
    assert route_results and route_results[0]["status"] == "success"
    assert route_results[0]["source_type"] == "seeded_demo"

    # Seeded demo vs public data clearly distinguished in provenance.
    by_field = {}
    for entry in snapshot["provenance"]:
        by_field.setdefault(entry["field"], set()).add(entry["source_type"])
    assert by_field["units"] == {"seeded_demo"}
    assert by_field["resources"] == {"seeded_demo"}
    assert by_field["roads"] == {"seeded_demo"}  # routing over the seeded graph
    assert by_field["weather"] == {"cached_public"}
    assert by_field["terrain"] == {"cached_public"}
    assert by_field["fire_hotspots"] == {"cached_public"}
    assert by_field["radio_events"] == {"human_report"}
    assert by_field["known_facts"] == {"model_inference"}

    # Staleness carried per datum from the real ToolResults.
    weather_prov = [e for e in snapshot["provenance"] if e["field"] == "weather"][0]
    assert weather_prov["is_cached"] is True
    assert weather_prov["staleness_seconds"] == 3600.0
    assert weather_prov["retrieved_at"] == WEATHER_CACHE["retrieved_at"]

    # The hallucinated tool never reached the executor.
    executed_names = {r["tool_name"] for r in executor.executed}
    assert "launch_water_drop" not in executed_names
    assert executed_names == {
        "get_weather",
        "get_elevation",
        "get_firms_hotspots",
        "get_units_resources",
        "compute_route",
    }


# ---------------------------------------------------------------------------
# Guardrail — the model cannot falsify provenance
# ---------------------------------------------------------------------------


@respx.mock
async def test_provenance_lie_corrected_to_cached_public(incident_ctx, radio_events):
    """Canned model claims source_type 'live_public' for a CACHED ToolResult —
    the deterministic post-processing rewrites it to 'cached_public'."""
    respx.post(VLLM_URL).mock(side_effect=[gemma_response(canned_snapshot())])
    executor = FakeCacheToolExecutor()
    client, agent = make_agent(executor)

    weather_result = executor.execute(
        {
            "tool_call_id": "sitctx-manual-weather",
            "agent_id": AGENT_ID,
            "tool_name": "get_weather",
            "arguments": {},
            "requested_at": "2026-07-25T10:59:00+00:00",
        }
    )
    assert weather_result["is_cached"] is True
    assert weather_result["source_type"] == "live_public"  # as recorded at fetch time

    async with client:
        snapshot = await agent.build_snapshot(
            incident_ctx, radio_events, [weather_result], version=1
        )

    weather_entries = [e for e in snapshot["provenance"] if e["field"] == "weather"]
    assert weather_entries, "weather must have provenance"
    assert all(e["source_type"] == "cached_public" for e in weather_entries)
    # No tool-backed field may carry the lied 'live_public' in this run.
    assert all(
        e["source_type"] != "live_public"
        for e in snapshot["provenance"]
        if e["field"] not in ("radio_events",)
    )


# ---------------------------------------------------------------------------
# Guardrail — missing information + unbacked sections
# ---------------------------------------------------------------------------


@respx.mock
async def test_missing_information_when_firms_absent(incident_ctx, radio_events):
    selection = {
        "tool_calls": [
            {"tool_name": "get_weather", "arguments": {}, "reason": "Wind check."},
            {"tool_name": "get_firms_hotspots", "arguments": {}, "reason": "Hotspot check."},
        ]
    }
    # Adversarial model output: invents hotspots and buildings, claims nothing
    # is missing — every lie must be corrected deterministically.
    lying_snapshot = canned_snapshot(
        fire_hotspots=[{"latitude": 43.45, "longitude": 3.75, "invented": True}],
        buildings_and_parcels=[{"building_id": "invented-1"}],
        terrain=None,
        roads=[],
        units=[],
        resources=[],
        missing_information=[],
    )
    respx.post(VLLM_URL).mock(
        side_effect=[gemma_response(selection), gemma_response(lying_snapshot)]
    )
    executor = FakeCacheToolExecutor(fail_tools=("get_firms_hotspots",))
    client, agent = make_agent(executor)
    async with client:
        run = await agent.run(incident_ctx, radio_events, version=1)

    snapshot = run.snapshot
    assert not list(SNAPSHOT_VALIDATOR.iter_errors(snapshot))

    # FIRMS failed -> no hotspot data may survive, and the gap is declared.
    assert snapshot["fire_hotspots"] == []
    assert snapshot["missing_information"], "missing_information must not be empty"
    assert any("get_firms_hotspots" in item for item in snapshot["missing_information"])
    assert any("fire_hotspots" in item for item in snapshot["missing_information"])

    # Buildings were never fetched -> invented section reset + declared missing.
    assert snapshot["buildings_and_parcels"] == []
    assert any("buildings_and_parcels" in item for item in snapshot["missing_information"])

    # No provenance entry exists for sections without real data.
    prov_fields = {e["field"] for e in snapshot["provenance"]}
    assert "fire_hotspots" not in prov_fields
    assert "buildings_and_parcels" not in prov_fields


# ---------------------------------------------------------------------------
# Robustness — executor failures stay isolated and contract-valid
# ---------------------------------------------------------------------------


def test_executor_exception_becomes_contract_valid_error_result():
    client = GemmaClient(agent=AGENT_ID)
    agent = SituationContextAgent(client, ExplodingExecutor())
    results = agent.execute_tools(
        [
            {
                "tool_call_id": "sitctx-x",
                "agent_id": AGENT_ID,
                "tool_name": "get_weather",
                "arguments": {},
                "requested_at": "2026-07-25T10:00:00+00:00",
            }
        ]
    )
    result_validator = Draft7Validator(
        json.loads((SCHEMA_DIR / "tool_result.schema.json").read_text(encoding="utf-8")),
        format_checker=FormatChecker(),
    )
    assert len(results) == 1
    assert results[0]["status"] == "error"
    assert "executor_exception" in results[0]["error"]
    assert not list(result_validator.iter_errors(results[0]))


# ---------------------------------------------------------------------------
# Prompt contract
# ---------------------------------------------------------------------------


def test_system_prompt_renders_catalog_and_forbids_orders():
    client = GemmaClient(agent=AGENT_ID)
    agent = SituationContextAgent(client, FakeCacheToolExecutor())
    prompt = agent._system_prompt
    assert "{{TOOL_CATALOG}}" not in prompt and "{{MAX_TOOL_CALLS}}" not in prompt
    for tool in (
        "get_weather",
        "get_elevation",
        "get_firms_hotspots",
        "get_cadastre_buildings",
        "get_osm_features",
        "compute_route",
        "get_units_resources",
    ):
        assert tool in prompt
    assert "NEVER issue orders" in prompt
    assert "seeded_demo" in prompt and "cached_public" in prompt
