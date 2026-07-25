"""Real-audio tests for the BLAZE STT service (issue #12).

These tests actually run faster-whisper (small, CPU int8) on the 5 committed
radio-degraded WAVs. The model is already in the local HF cache since #3.

Run (from repo root):
    speech/stt/.venv/Scripts/python -m pytest speech/stt/test_stt_service.py -v -s
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

sys.path.insert(0, str(Path(__file__).resolve().parent))

from service import REPO_ROOT, SttService, load_manifest  # noqa: E402

SCHEMA_PATH = REPO_ROOT / "contracts" / "schemas" / "transcript_result.schema.json"


@pytest.fixture(scope="module")
def schema_validator() -> Draft7Validator:
    with open(SCHEMA_PATH, encoding="utf-8") as fh:
        return Draft7Validator(json.load(fh))


@pytest.fixture(scope="module")
def manifest_items():
    items = load_manifest()
    assert len(items) == 5
    return items


@pytest.fixture(scope="module")
def service() -> SttService:
    return SttService()  # env defaults: small / fr / cpu / int8


@pytest.fixture(scope="module")
def timed_runs(service: SttService, manifest_items):
    """Run the 5 radio audios sequentially then concurrently, once per session.

    Returns (sequential_results, sequential_s, concurrent_results, concurrent_s,
    callback_order).
    """
    _ = service.model  # load outside both timings: we compare inference only

    t0 = time.perf_counter()
    seq_results = [
        service.transcribe(REPO_ROOT / item["radio_path"], item["audio_id"])
        for item in manifest_items
    ]
    sequential_s = time.perf_counter() - t0

    callback_order: list[str] = []
    t1 = time.perf_counter()
    conc_results = service.transcribe_batch(
        manifest_items,
        variant="radio",
        on_result=lambda r: callback_order.append(r.audio_id),
    )
    concurrent_s = time.perf_counter() - t1

    print(
        f"\n[timing] sequential: {sequential_s:.2f}s | "
        f"concurrent (max_workers={service.max_workers}): {concurrent_s:.2f}s | "
        f"speedup: {sequential_s / concurrent_s:.2f}x"
    )
    return seq_results, sequential_s, conc_results, concurrent_s, callback_order


def test_all_five_radio_audios_transcribe(timed_runs, schema_validator):
    """5 radio WAVs -> non-empty French text, measured latency, schema-valid."""
    _, _, results, _, _ = timed_runs
    assert len(results) == 5
    for result in results:
        payload = result.to_dict()
        errors = list(schema_validator.iter_errors(payload))
        assert not errors, f"{result.audio_id}: schema errors: {errors}"
        assert result.fallback_used is False
        assert result.language == "fr"
        assert len(result.text.strip()) > 20, f"{result.audio_id}: text too short"
        assert result.latency_ms > 0
        assert result.started_at < result.completed_at
        assert result.model_name == "faster-whisper-small"
        assert result.segments, f"{result.audio_id}: no segments"
        for seg in result.segments:
            assert seg.end >= seg.start
            if seg.confidence is not None:
                assert 0.0 <= seg.confidence <= 1.0
        print(f"[{result.audio_id}] ({result.latency_ms:.0f} ms) {result.text}")


def test_transcripts_contain_scenario_vocabulary(timed_runs):
    """Usable French: scenario domain words must appear across the 5 transcripts."""
    _, _, results, _, _ = timed_runs
    all_text = " ".join(r.text.lower() for r in results)
    expected_any = ["d17", "hangar", "fumée", "explosion", "alpha", "bravo", "route"]
    hits = [w for w in expected_any if w in all_text]
    assert len(hits) >= 4, f"too few domain words found: {hits}"


def test_concurrent_batch_faster_than_sequential(timed_runs):
    seq_results, sequential_s, conc_results, concurrent_s, _ = timed_runs
    assert concurrent_s < sequential_s, (
        f"concurrent ({concurrent_s:.2f}s) not faster than sequential ({sequential_s:.2f}s)"
    )
    # Concurrent must match sequential content-wise (same model, same audio).
    assert [r.audio_id for r in conc_results] == [r.audio_id for r in seq_results]


def test_batch_preserves_scenario_order(timed_runs, manifest_items):
    _, _, results, _, callback_order = timed_runs
    assert [r.audio_id for r in results] == [i["audio_id"] for i in manifest_items]
    assert sorted(callback_order) == sorted(i["audio_id"] for i in manifest_items)


def test_missing_audio_falls_back_to_reference(service, schema_validator):
    """A broken item never crashes the batch: fallback_used=True + reference text."""
    items = [
        {
            "audio_id": "audio_ghost",
            "radio_path": "data/audio/does_not_exist.wav",
            "reference_transcript": "Alpha 3, message de secours.",
        }
    ]
    results = service.transcribe_batch(items, variant="radio")
    assert len(results) == 1
    result = results[0]
    assert result.fallback_used is True
    assert result.text == "Alpha 3, message de secours."
    payload = result.to_dict()
    errors = list(schema_validator.iter_errors(payload))
    assert not errors, f"fallback result schema errors: {errors}"


def test_transcribe_missing_file_raises(service):
    with pytest.raises(FileNotFoundError):
        service.transcribe("data/audio/nope.wav", "audio_nope")


def test_invalid_variant_rejected(service):
    with pytest.raises(ValueError):
        service.transcribe_batch([], variant="noisy")
