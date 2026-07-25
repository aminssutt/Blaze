"""Tests for the BLAZE measured-only metrics collector (ticket #11)."""

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pytest

import inference.metrics.collector as collector_module
from inference.metrics import (
    ENGINE_NAME,
    GPU_NOT_DETECTED,
    MODEL_NOT_CONFIGURED,
    CallStats,
    MetricsCollector,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "schemas"
    / "event_envelope.schema.json"
)


# --------------------------------------------------------------------- #
# Helpers / fixtures
# --------------------------------------------------------------------- #


class _FakeCompleted:
    def __init__(self, stdout: str = "", returncode: int = 0):
        self.stdout = stdout
        self.returncode = returncode


@pytest.fixture
def no_gpu(monkeypatch):
    """Simulate a machine without nvidia-smi (binary absent)."""

    def _raise(*args, **kwargs):
        raise FileNotFoundError("nvidia-smi not found")

    monkeypatch.setattr(collector_module.subprocess, "run", _raise)


@pytest.fixture
def fake_gpu(monkeypatch):
    """Simulate a machine where nvidia-smi reports one GPU."""

    calls = {"count": 0}

    def _run(cmd, **kwargs):
        calls["count"] += 1
        assert cmd == ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"]
        return _FakeCompleted(stdout="NVIDIA GeForce RTX 4090\n")

    monkeypatch.setattr(collector_module.subprocess, "run", _run)
    return calls


def make_collector(**kwargs) -> MetricsCollector:
    kwargs.setdefault("env", {})
    return MetricsCollector(**kwargs)


# --------------------------------------------------------------------- #
# GPU detection
# --------------------------------------------------------------------- #


def test_gpu_detected_via_nvidia_smi(fake_gpu):
    c = make_collector()
    assert c.detect_gpu() == "NVIDIA GeForce RTX 4090"


def test_gpu_absent_binary_degrades_without_crash(no_gpu):
    c = make_collector()
    assert c.detect_gpu() == GPU_NOT_DETECTED
    snap = c.snapshot()
    assert snap["gpu_name"] == GPU_NOT_DETECTED
    assert "gpu_name" in snap["unavailable"]


def test_gpu_timeout_degrades_to_not_detected(monkeypatch):
    def _timeout(cmd, **kwargs):
        assert kwargs["timeout"] == pytest.approx(2.0)
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs["timeout"])

    monkeypatch.setattr(collector_module.subprocess, "run", _timeout)
    assert make_collector().detect_gpu() == GPU_NOT_DETECTED


def test_gpu_nonzero_exit_degrades_to_not_detected(monkeypatch):
    monkeypatch.setattr(
        collector_module.subprocess,
        "run",
        lambda cmd, **kw: _FakeCompleted(stdout="", returncode=9),
    )
    assert make_collector().detect_gpu() == GPU_NOT_DETECTED


def test_gpu_empty_output_degrades_to_not_detected(monkeypatch):
    monkeypatch.setattr(
        collector_module.subprocess,
        "run",
        lambda cmd, **kw: _FakeCompleted(stdout="\n  \n"),
    )
    assert make_collector().detect_gpu() == GPU_NOT_DETECTED


def test_gpu_multi_gpu_reports_first(monkeypatch):
    monkeypatch.setattr(
        collector_module.subprocess,
        "run",
        lambda cmd, **kw: _FakeCompleted(stdout="NVIDIA A100\nNVIDIA A100\n"),
    )
    assert make_collector().detect_gpu() == "NVIDIA A100"


def test_gpu_probe_is_cached(fake_gpu):
    c = make_collector()
    c.detect_gpu()
    c.detect_gpu()
    c.snapshot()
    assert fake_gpu["count"] == 1
    c.detect_gpu(force=True)
    assert fake_gpu["count"] == 2


def test_detected_gpu_not_listed_unavailable(fake_gpu):
    snap = make_collector().snapshot()
    assert snap["gpu_name"] == "NVIDIA GeForce RTX 4090"
    assert "gpu_name" not in snap["unavailable"]


# --------------------------------------------------------------------- #
# record_call aggregates
# --------------------------------------------------------------------- #


def test_record_call_aggregates_latency_percentiles(no_gpu):
    c = make_collector()
    for ms, conc in [(100, 1), (200, 3), (300, 2), (400, 1), (500, 2)]:
        c.record_call(latency_ms=ms, concurrent=conc)
    snap = c.snapshot()
    assert snap["gemma_agent_calls"] == 5
    assert snap["concurrent_requests_peak"] == 3
    assert snap["avg_request_latency_ms"] == pytest.approx(300.0)
    assert snap["p50_request_latency_ms"] == pytest.approx(300.0)
    # linear interpolation: rank 3.8 between 400 and 500 -> 480
    assert snap["p95_request_latency_ms"] == pytest.approx(480.0)


def test_single_call_percentiles(no_gpu):
    c = make_collector()
    c.record_call(latency_ms=123.4)
    snap = c.snapshot()
    assert snap["avg_request_latency_ms"] == pytest.approx(123.4)
    assert snap["p50_request_latency_ms"] == pytest.approx(123.4)
    assert snap["p95_request_latency_ms"] == pytest.approx(123.4)


def test_no_calls_latency_fields_null_and_unavailable(no_gpu):
    snap = make_collector().snapshot()
    assert snap["gemma_agent_calls"] == 0
    assert snap["concurrent_requests_peak"] == 0
    for field in (
        "avg_request_latency_ms",
        "p50_request_latency_ms",
        "p95_request_latency_ms",
        "end_to_end_latency_ms",
        "tokens_per_second",
    ):
        assert snap[field] is None
        assert field in snap["unavailable"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"latency_ms": -1.0},
        {"latency_ms": float("nan")},
        {"latency_ms": float("inf")},
        {"latency_ms": 10.0, "tokens_in": -1},
        {"latency_ms": 10.0, "tokens_out": -5},
        {"latency_ms": 10.0, "concurrent": 0},
    ],
)
def test_record_call_rejects_impossible_measurements(no_gpu, kwargs):
    with pytest.raises(ValueError):
        make_collector().record_call(**kwargs)


# --------------------------------------------------------------------- #
# tokens/s — measured only
# --------------------------------------------------------------------- #


def test_tokens_per_second_absent_without_usage(no_gpu):
    c = make_collector()
    c.record_call(latency_ms=500.0)  # engine gave no usage block
    snap = c.snapshot()
    assert snap["tokens_per_second"] is None
    assert snap["tokens_in_total"] is None
    assert snap["tokens_out_total"] is None
    assert "tokens_per_second" in snap["unavailable"]
    assert "tokens_out_total" in snap["unavailable"]


def test_tokens_per_second_computed_from_usage(no_gpu):
    c = make_collector()
    c.record_call(latency_ms=1000.0, tokens_in=50, tokens_out=100)
    c.record_call(latency_ms=1000.0, tokens_in=30, tokens_out=100)
    snap = c.snapshot()
    assert snap["tokens_in_total"] == 80
    assert snap["tokens_out_total"] == 200
    # 200 tokens over 2000 ms of usage-covered latency -> 100 tok/s
    assert snap["tokens_per_second"] == pytest.approx(100.0)
    assert "tokens_per_second" not in snap["unavailable"]


def test_tokens_per_second_only_counts_calls_with_usage(no_gpu):
    c = make_collector()
    c.record_call(latency_ms=1000.0, tokens_out=100)
    c.record_call(latency_ms=9000.0)  # no usage: must not dilute tokens/s
    snap = c.snapshot()
    assert snap["tokens_per_second"] == pytest.approx(100.0)
    assert snap["gemma_agent_calls"] == 2


# --------------------------------------------------------------------- #
# CallStats duck typing (ticket #10 / #52 seam)
# --------------------------------------------------------------------- #


@dataclass
class _ForeignCallLogEntry:
    """Stand-in for ticket #10's CallLog entry: no import from metrics."""

    latency_ms: float
    tokens_in: Optional[int]
    tokens_out: Optional[int]
    concurrent: int


def test_record_call_stats_duck_typed(no_gpu):
    entry = _ForeignCallLogEntry(
        latency_ms=250.0, tokens_in=10, tokens_out=25, concurrent=4
    )
    assert isinstance(entry, CallStats)  # structural, not nominal
    c = make_collector()
    c.record_call_stats(entry)
    snap = c.snapshot()
    assert snap["gemma_agent_calls"] == 1
    assert snap["concurrent_requests_peak"] == 4
    assert snap["tokens_out_total"] == 25


# --------------------------------------------------------------------- #
# End-to-end latency
# --------------------------------------------------------------------- #


def test_end_to_end_latency_measured(no_gpu):
    now = {"t": 100.0}
    c = make_collector(monotonic=lambda: now["t"])
    c.start_incident()
    now["t"] = 103.5
    assert c.end_incident() == pytest.approx(3500.0)
    snap = c.snapshot()
    assert snap["end_to_end_latency_ms"] == pytest.approx(3500.0)
    assert "end_to_end_latency_ms" not in snap["unavailable"]


def test_end_to_end_null_while_incident_running(no_gpu):
    c = make_collector()
    c.start_incident()
    snap = c.snapshot()
    assert snap["end_to_end_latency_ms"] is None
    assert "end_to_end_latency_ms" in snap["unavailable"]


def test_end_incident_without_start_returns_none(no_gpu):
    c = make_collector()
    assert c.end_incident() is None
    assert make_collector().snapshot()["end_to_end_latency_ms"] is None


# --------------------------------------------------------------------- #
# Engine, model id, network mode, cloud calls
# --------------------------------------------------------------------- #


def test_engine_name_is_vllm(no_gpu):
    assert make_collector().snapshot()["inference_engine"] == ENGINE_NAME == "vllm"


def test_model_id_from_env(no_gpu):
    snap = MetricsCollector(env={"GEMMA_MODEL_ID": "google/gemma-4-27b-it"}).snapshot()
    assert snap["model_id"] == "google/gemma-4-27b-it"
    assert "model_id" not in snap["unavailable"]


def test_model_id_not_configured(no_gpu):
    snap = make_collector().snapshot()
    assert snap["model_id"] == MODEL_NOT_CONFIGURED
    assert "model_id" in snap["unavailable"]


def test_network_mode_from_env(no_gpu):
    snap = MetricsCollector(env={"NETWORK_MODE": "Offline"}).snapshot()
    assert snap["network_mode"] == "offline"
    assert "network_mode" not in snap["unavailable"]


def test_network_mode_unset_is_null(no_gpu):
    snap = make_collector().snapshot()
    assert snap["network_mode"] is None
    assert "network_mode" in snap["unavailable"]


def test_cloud_calls_default_zero_and_countable(no_gpu):
    c = make_collector()
    assert c.snapshot()["cloud_llm_calls"] == 0
    c.record_cloud_call()  # accidental call must become visible, not hidden
    assert c.snapshot()["cloud_llm_calls"] == 1


# --------------------------------------------------------------------- #
# Snapshot payload contract
# --------------------------------------------------------------------- #


def test_snapshot_is_json_serializable(no_gpu):
    c = make_collector()
    c.record_call(latency_ms=100.0, tokens_in=5, tokens_out=10, concurrent=2)
    c.start_incident()
    c.end_incident()
    payload = c.snapshot()
    round_tripped = json.loads(json.dumps(payload))
    assert round_tripped == payload


def test_snapshot_has_no_invented_numbers(no_gpu):
    """Every unmeasured field is None (never a placeholder number)."""
    snap = make_collector().snapshot()
    measured_zeroes = {"gemma_agent_calls", "concurrent_requests_peak", "cloud_llm_calls"}
    for key, value in snap.items():
        if key in measured_zeroes | {"unavailable", "gpu_name", "inference_engine", "model_id"}:
            continue
        assert value is None, f"{key} must be None when unmeasured, got {value!r}"


def test_snapshot_payload_fits_event_envelope_contract(no_gpu):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert "metric.updated" in schema["properties"]["event_type"]["enum"]
    envelope = {
        "event_id": "evt-test-001",
        "incident_id": "incident-test",
        "event_type": "metric.updated",
        "timestamp": "2026-07-25T10:00:00.000Z",
        "sequence": 1,
        "payload": make_collector().snapshot(),
    }
    jsonschema.validate(instance=envelope, schema=schema)


# --------------------------------------------------------------------- #
# reset() and demo-rerun behaviour
# --------------------------------------------------------------------- #


def test_reset_restores_pristine_state(fake_gpu):
    c = make_collector()
    c.record_call(latency_ms=100.0, tokens_out=10, concurrent=3)
    c.record_cloud_call()
    c.start_incident()
    c.end_incident()
    c.reset()
    snap = c.snapshot()
    assert snap["gemma_agent_calls"] == 0
    assert snap["concurrent_requests_peak"] == 0
    assert snap["cloud_llm_calls"] == 0
    assert snap["avg_request_latency_ms"] is None
    assert snap["end_to_end_latency_ms"] is None
    assert snap["tokens_out_total"] is None
    assert snap["tokens_per_second"] is None


def test_reset_keeps_cached_gpu_probe(fake_gpu):
    c = make_collector()
    c.snapshot()
    c.reset()
    c.snapshot()
    assert fake_gpu["count"] == 1
    c.reset(forget_gpu=True)
    c.snapshot()
    assert fake_gpu["count"] == 2


def test_metrics_survive_five_audio_run_without_drift(no_gpu):
    """Cumulative counters stay coherent across 5 incidents (5-audio demo)."""
    now = {"t": 0.0}
    c = make_collector(monotonic=lambda: now["t"])
    for audio in range(5):
        c.start_incident()
        for _ in range(3):
            now["t"] += 1.0
            c.record_call(latency_ms=1000.0, tokens_in=20, tokens_out=50, concurrent=2)
        c.end_incident()
    snap = c.snapshot()
    assert snap["gemma_agent_calls"] == 15
    assert snap["tokens_in_total"] == 300
    assert snap["tokens_out_total"] == 750
    assert snap["tokens_per_second"] == pytest.approx(50.0)
    assert snap["cloud_llm_calls"] == 0
    # e2e reflects the last completed incident (3 s), not an accumulation.
    assert snap["end_to_end_latency_ms"] == pytest.approx(3000.0)
    # A rerun after reset behaves identically.
    c.reset()
    assert c.snapshot()["gemma_agent_calls"] == 0
