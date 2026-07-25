"""BLAZE NVIDIA metrics collector (ticket #11).

Aggregates ONLY measured values — never invented ones:

* detected GPU name (``nvidia-smi``, 2 s timeout, ``"not_detected"`` on failure),
* inference engine name (``"vllm"``),
* model id (env ``GEMMA_MODEL_ID``, ``"not_configured"`` when unset),
* per-request latency (fed by :meth:`MetricsCollector.record_call`),
* end-to-end incident latency (:meth:`MetricsCollector.start_incident` /
  :meth:`MetricsCollector.end_incident`),
* tokens/s — computed ONLY when the engine reported token usage,
* agent call count, peak concurrency, cloud call count (must stay 0),
* online/offline status (env ``NETWORK_MODE``).

:meth:`MetricsCollector.snapshot` returns the payload for a ``metric.updated``
event conforming to ``contracts/schemas/event_envelope.schema.json`` (the
payload only — the orchestrator wraps it in the envelope and emits it).
Anything not measured is ``None`` and listed under ``"unavailable"`` —
never a made-up number.

Integration note (ticket #52): the shared Gemma client from ticket #10 exposes
a CallLog. Its entries plug into this collector through the duck-typed
:class:`CallStats` protocol via :meth:`MetricsCollector.record_call_stats`.
This module deliberately does NOT import anything from ``agents/common``.
"""

from __future__ import annotations

import math
import os
import subprocess
import threading
import time
from typing import Any, Callable, Dict, List, Mapping, Optional, Protocol, runtime_checkable

__all__ = [
    "CallStats",
    "MetricsCollector",
    "ENGINE_NAME",
    "GPU_NOT_DETECTED",
    "MODEL_NOT_CONFIGURED",
    "NVIDIA_SMI_TIMEOUT_S",
]

ENGINE_NAME = "vllm"
GPU_NOT_DETECTED = "not_detected"
MODEL_NOT_CONFIGURED = "not_configured"
NVIDIA_SMI_TIMEOUT_S = 2.0

_NVIDIA_SMI_CMD = ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"]

MODEL_ID_ENV_VAR = "GEMMA_MODEL_ID"
NETWORK_MODE_ENV_VAR = "NETWORK_MODE"


@runtime_checkable
class CallStats(Protocol):
    """Duck-typed contract for one inference call record.

    Ticket #10's shared client keeps a CallLog; each entry must satisfy this
    shape so ticket #52 can wire it into
    :meth:`MetricsCollector.record_call_stats`. Any object exposing these
    attributes qualifies (no import from this module required):

    Attributes:
        latency_ms: Measured wall-clock latency of the request, milliseconds.
        tokens_in: Prompt tokens from the engine ``usage`` block, or ``None``
            when the engine did not report usage.
        tokens_out: Completion tokens from the engine ``usage`` block, or
            ``None`` when the engine did not report usage.
        concurrent: Number of in-flight requests at the moment of this call
            (>= 1, the call itself included).
    """

    latency_ms: float
    tokens_in: Optional[int]
    tokens_out: Optional[int]
    concurrent: int


def _percentile(sorted_values: List[float], pct: float) -> float:
    """Linear-interpolation percentile of an already sorted, non-empty list."""
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    rank = (len(sorted_values) - 1) * (pct / 100.0)
    lo = math.floor(rank)
    hi = math.ceil(rank)
    if lo == hi:
        return float(sorted_values[lo])
    frac = rank - lo
    return sorted_values[lo] * (1.0 - frac) + sorted_values[hi] * frac


class MetricsCollector:
    """Thread-safe aggregator of measured inference metrics.

    Counters are cumulative across incidents so a full 5-audio demo run keeps
    coherent totals; end-to-end latency is per-incident (last completed one).
    ``reset()`` restores a pristine state for a demo rerun.
    """

    def __init__(
        self,
        *,
        env: Optional[Mapping[str, str]] = None,
        monotonic: Optional[Callable[[], float]] = None,
        nvidia_smi_timeout_s: float = NVIDIA_SMI_TIMEOUT_S,
    ) -> None:
        """
        Args:
            env: Environment mapping (defaults to ``os.environ``); read lazily
                at snapshot time so late configuration is picked up.
            monotonic: Injectable monotonic clock (seconds) for deterministic
                tests. Defaults to :func:`time.monotonic`.
            nvidia_smi_timeout_s: Timeout for the ``nvidia-smi`` probe.
        """
        self._env = env
        self._monotonic = monotonic or time.monotonic
        self._nvidia_smi_timeout_s = nvidia_smi_timeout_s
        self._lock = threading.Lock()
        self._gpu_name: Optional[str] = None  # None = not probed yet (cached after)
        self._init_measurements()

    # ------------------------------------------------------------------ #
    # Recording
    # ------------------------------------------------------------------ #

    def record_call(
        self,
        latency_ms: float,
        tokens_in: Optional[int] = None,
        tokens_out: Optional[int] = None,
        concurrent: int = 1,
    ) -> None:
        """Record one measured inference call.

        Args:
            latency_ms: Measured request latency in milliseconds (>= 0).
            tokens_in: Prompt tokens from the engine usage block, if reported.
            tokens_out: Completion tokens from the engine usage block, if
                reported. tokens/s is only ever computed from calls where this
                is present.
            concurrent: In-flight requests at call time (>= 1).

        Raises:
            ValueError: On negative latency/token counts or ``concurrent < 1``
                (we never store impossible "measurements").
        """
        latency_ms = float(latency_ms)
        if not math.isfinite(latency_ms) or latency_ms < 0:
            raise ValueError(f"latency_ms must be a finite value >= 0, got {latency_ms!r}")
        if tokens_in is not None and tokens_in < 0:
            raise ValueError(f"tokens_in must be >= 0, got {tokens_in!r}")
        if tokens_out is not None and tokens_out < 0:
            raise ValueError(f"tokens_out must be >= 0, got {tokens_out!r}")
        if concurrent < 1:
            raise ValueError(f"concurrent must be >= 1, got {concurrent!r}")

        with self._lock:
            self._latencies_ms.append(latency_ms)
            self._call_count += 1
            self._concurrent_peak = max(self._concurrent_peak, int(concurrent))
            if tokens_in is not None:
                self._tokens_in_total = (self._tokens_in_total or 0) + int(tokens_in)
            if tokens_out is not None:
                self._tokens_out_total = (self._tokens_out_total or 0) + int(tokens_out)
                self._usage_latency_ms_total += latency_ms

    def record_call_stats(self, stats: CallStats) -> None:
        """Record a call from any :class:`CallStats`-shaped object (duck typed).

        This is the integration point for ticket #10's CallLog entries
        (wired in ticket #52).
        """
        self.record_call(
            latency_ms=stats.latency_ms,
            tokens_in=stats.tokens_in,
            tokens_out=stats.tokens_out,
            concurrent=stats.concurrent,
        )

    def record_cloud_call(self) -> None:
        """Count a cloud LLM call. BLAZE is local-only: this must stay at 0.

        The counter exists so the panel shows a *measured* zero, and so any
        accidental cloud call is visible instead of hidden.
        """
        with self._lock:
            self._cloud_calls += 1

    def start_incident(self) -> None:
        """Mark the start of an incident for end-to-end latency measurement.

        Starting a new incident discards the in-progress start (if any) but
        keeps the last *completed* end-to-end measurement until a new one
        completes.
        """
        with self._lock:
            self._incident_started_at = self._monotonic()

    def end_incident(self) -> Optional[float]:
        """Close the current incident and store its end-to-end latency.

        Returns:
            The measured end-to-end latency in milliseconds, or ``None`` if no
            :meth:`start_incident` was pending (nothing is invented).
        """
        with self._lock:
            if self._incident_started_at is None:
                return None
            elapsed_ms = (self._monotonic() - self._incident_started_at) * 1000.0
            self._incident_started_at = None
            self._end_to_end_ms = elapsed_ms
            return elapsed_ms

    # ------------------------------------------------------------------ #
    # Detection / environment
    # ------------------------------------------------------------------ #

    def detect_gpu(self, force: bool = False) -> str:
        """Return the GPU name via ``nvidia-smi`` (cached after first probe).

        Never raises: any failure (binary missing, timeout after
        ``nvidia_smi_timeout_s`` seconds, non-zero exit, empty output) degrades
        to ``"not_detected"``.

        Args:
            force: Re-run the probe even if a cached result exists.
        """
        with self._lock:
            if self._gpu_name is not None and not force:
                return self._gpu_name
        name = self._probe_nvidia_smi()
        with self._lock:
            self._gpu_name = name
            return self._gpu_name

    def _probe_nvidia_smi(self) -> str:
        try:
            result = subprocess.run(
                _NVIDIA_SMI_CMD,
                capture_output=True,
                text=True,
                timeout=self._nvidia_smi_timeout_s,
            )
        except (OSError, subprocess.SubprocessError):
            # FileNotFoundError (no nvidia-smi), TimeoutExpired, etc.
            return GPU_NOT_DETECTED
        if result.returncode != 0:
            return GPU_NOT_DETECTED
        # One name per line when several GPUs are present; report the first.
        first_line = next(
            (line.strip() for line in result.stdout.splitlines() if line.strip()), ""
        )
        return first_line or GPU_NOT_DETECTED

    def _read_env(self, key: str) -> Optional[str]:
        env = self._env if self._env is not None else os.environ
        value = env.get(key)
        if value is None:
            return None
        value = value.strip()
        return value or None

    # ------------------------------------------------------------------ #
    # Snapshot / reset
    # ------------------------------------------------------------------ #

    def snapshot(self) -> Dict[str, Any]:
        """Build the ``metric.updated`` event payload (JSON-serializable).

        Every value is either measured/configured or ``None``; ``None`` fields
        are listed in ``"unavailable"``, together with ``gpu_name`` when the
        probe degraded to ``"not_detected"`` and ``model_id`` when it is
        ``"not_configured"`` (sentinels mandated by the ticket, still not
        actual measurements). No placeholder numbers, ever.
        """
        gpu_name = self.detect_gpu()
        model_id = self._read_env(MODEL_ID_ENV_VAR) or MODEL_NOT_CONFIGURED
        network_mode_raw = self._read_env(NETWORK_MODE_ENV_VAR)
        network_mode = network_mode_raw.lower() if network_mode_raw else None

        with self._lock:
            latencies = sorted(self._latencies_ms)
            call_count = self._call_count
            concurrent_peak = self._concurrent_peak
            cloud_calls = self._cloud_calls
            tokens_in_total = self._tokens_in_total
            tokens_out_total = self._tokens_out_total
            usage_latency_ms_total = self._usage_latency_ms_total
            end_to_end_ms = self._end_to_end_ms

        if latencies:
            avg_ms: Optional[float] = round(sum(latencies) / len(latencies), 2)
            p50_ms: Optional[float] = round(_percentile(latencies, 50.0), 2)
            p95_ms: Optional[float] = round(_percentile(latencies, 95.0), 2)
        else:
            avg_ms = p50_ms = p95_ms = None

        # tokens/s ONLY from calls that came with real usage data.
        tokens_per_second: Optional[float] = None
        if tokens_out_total is not None and usage_latency_ms_total > 0:
            tokens_per_second = round(
                tokens_out_total / (usage_latency_ms_total / 1000.0), 2
            )

        payload: Dict[str, Any] = {
            "gpu_name": gpu_name,
            "inference_engine": ENGINE_NAME,
            "model_id": model_id,
            "gemma_agent_calls": call_count,
            "concurrent_requests_peak": concurrent_peak,
            "avg_request_latency_ms": avg_ms,
            "p50_request_latency_ms": p50_ms,
            "p95_request_latency_ms": p95_ms,
            "end_to_end_latency_ms": (
                round(end_to_end_ms, 2) if end_to_end_ms is not None else None
            ),
            "tokens_in_total": tokens_in_total,
            "tokens_out_total": tokens_out_total,
            "tokens_per_second": tokens_per_second,
            "cloud_llm_calls": cloud_calls,
            "network_mode": network_mode,
        }

        unavailable = [key for key, value in payload.items() if value is None]
        if gpu_name == GPU_NOT_DETECTED:
            unavailable.append("gpu_name")
        if model_id == MODEL_NOT_CONFIGURED:
            unavailable.append("model_id")
        payload["unavailable"] = sorted(unavailable)
        return payload

    def reset(self, *, forget_gpu: bool = False) -> None:
        """Wipe every measurement for a clean demo rerun.

        The cached GPU probe result is kept by default (the hardware does not
        change between reruns and re-probing costs up to the probe timeout);
        pass ``forget_gpu=True`` to force a fresh probe on next use.
        """
        with self._lock:
            self._init_measurements()
            if forget_gpu:
                self._gpu_name = None

    def _init_measurements(self) -> None:
        """(Re)initialize measured state. Caller must hold the lock, or be
        the constructor."""
        self._latencies_ms: List[float] = []
        self._call_count: int = 0
        self._concurrent_peak: int = 0
        self._cloud_calls: int = 0
        self._tokens_in_total: Optional[int] = None
        self._tokens_out_total: Optional[int] = None
        self._usage_latency_ms_total: float = 0.0
        self._incident_started_at: Optional[float] = None
        self._end_to_end_ms: Optional[float] = None
