"""Acceptance tests for the BLAZE evaluation dataset + runner (issue #19).

1. Dataset integrity: >= 25 labeled French messages, required difficulty
   categories covered, every gold expected_event materializes into a
   schema-valid RadioEvent (contracts/schemas/radio_event.schema.json).
2. Perfect extractor (the gold labels replayed) scores 100% everywhere and
   zero unsupported facts.
3. Degraded extractor (controlled, disjoint mutations) drops each metric by
   exactly the amount implied by the mutations — no more, no less.
"""

import copy
import json
import sys
from pathlib import Path

import jsonschema
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from inference.evaluation.runner import (  # noqa: E402
    DEFAULT_DATASET_PATH,
    DEFAULT_SCHEMA_PATH,
    TOOL_ALLOWLIST,
    ExtractionResult,
    build_gold_event,
    load_dataset,
    load_schema,
    make_gold_extractor,
    render_markdown,
    run_evaluation,
)

EVENT_TYPES = {
    "hazard_report",
    "resource_update",
    "road_status",
    "wind_update",
    "correction",
    "confirmation",
    "position_update",
    "other",
}
URGENCIES = {"low", "medium", "high", "critical"}
CONFIRMATION_STATUSES = {"reported", "inferred", "confirmed"}

REQUIRED_CATEGORIES = {
    "demo",
    "negation",
    "correction",
    "vehicle_restriction",
    "ambiguous_numbers",
    "missing_speaker",
    "contradiction",
    "confirmation_status",
    "noisy_stt",
}


@pytest.fixture(scope="module")
def dataset():
    return load_dataset(DEFAULT_DATASET_PATH)


@pytest.fixture(scope="module")
def schema():
    return load_schema(DEFAULT_SCHEMA_PATH)


# ---------------------------------------------------------------------------
# 1. Dataset integrity
# ---------------------------------------------------------------------------


def test_dataset_has_at_least_25_messages(dataset):
    assert len(dataset) >= 25


def test_dataset_ids_unique(dataset):
    ids = [entry["id"] for entry in dataset]
    assert len(ids) == len(set(ids))


def test_dataset_covers_required_categories(dataset):
    categories = {entry["category"] for entry in dataset}
    missing = REQUIRED_CATEGORIES - categories
    assert not missing, f"Missing difficulty categories: {missing}"


def test_dataset_includes_five_demo_transcripts(dataset):
    manifest_path = REPO_ROOT / "data" / "audio" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dataset_transcripts = {entry["transcript"] for entry in dataset}
    for item in manifest:
        assert item["reference_transcript"] in dataset_transcripts, (
            f"Demo transcript {item['audio_id']} missing from the dataset"
        )


def test_entries_have_required_fields(dataset):
    required = {
        "id",
        "category",
        "transcript",
        "speaker_expected",
        "expected_events",
        "expected_tool_suggestions",
        "notes",
    }
    for entry in dataset:
        missing = required - set(entry)
        assert not missing, f"{entry.get('id')}: missing fields {missing}"
        assert entry["transcript"].strip()
        assert len(entry["expected_events"]) >= 1
        assert isinstance(entry["expected_tool_suggestions"], list)


def test_gold_labels_use_contract_enums(dataset):
    for entry in dataset:
        for event in entry["expected_events"]:
            assert event["event_type"] in EVENT_TYPES, entry["id"]
            assert event["urgency"] in URGENCIES, entry["id"]
            assert (
                event["confirmation_status"] in CONFIRMATION_STATUSES
            ), entry["id"]
            assert isinstance(event["is_correction"], bool), entry["id"]
            assert isinstance(event["facts"], list) and event["facts"], (
                entry["id"]
            )


def test_tool_suggestions_are_allowlisted(dataset):
    for entry in dataset:
        extra = set(entry["expected_tool_suggestions"]) - TOOL_ALLOWLIST
        assert not extra, f"{entry['id']}: unknown tools {extra}"


def test_missing_speaker_entries_have_null_speaker(dataset):
    missing_speaker = [
        e for e in dataset if e["category"] == "missing_speaker"
    ]
    assert len(missing_speaker) >= 2
    for entry in missing_speaker:
        assert entry["speaker_expected"] is None
        for event in entry["expected_events"]:
            assert event["unit_id"] is None


def test_gold_events_are_schema_compatible(dataset, schema):
    """Every gold label, materialized as a full RadioEvent, must validate."""
    validator = jsonschema.Draft7Validator(schema)
    for entry in dataset:
        for index, expected in enumerate(entry["expected_events"]):
            event = build_gold_event(entry, expected, index)
            errors = list(validator.iter_errors(event))
            assert not errors, (
                f"{entry['id']} event {index}: {[e.message for e in errors]}"
            )


# ---------------------------------------------------------------------------
# 2. Perfect extractor -> 100% everywhere
# ---------------------------------------------------------------------------


def test_perfect_extractor_scores_100(dataset, tmp_path):
    report = run_evaluation(
        make_gold_extractor(dataset), output_dir=tmp_path
    )
    metrics = report["metrics"]

    assert metrics["valid_event_rate"] == 1.0
    assert metrics["unit_accuracy"] == 1.0
    assert metrics["location_accuracy"] == 1.0
    assert metrics["correction_precision"] == 1.0
    assert metrics["correction_recall"] == 1.0
    assert metrics["correction_f1"] == 1.0
    assert metrics["confirmation_status_accuracy"] == 1.0
    assert metrics["tool_suggestion_jaccard"] == 1.0
    assert metrics["unsupported_fact_count"] == 0
    assert metrics["unsupported_fact_rate"] == 0.0
    assert metrics["extraction_failures"] == 0

    assert report["dataset"]["messages"] == len(dataset)

    # Output artifacts: metrics.json + markdown table.
    metrics_json = tmp_path / "metrics.json"
    metrics_md = tmp_path / "metrics.md"
    assert metrics_json.is_file() and metrics_md.is_file()
    parsed = json.loads(metrics_json.read_text(encoding="utf-8"))
    assert parsed["metrics"]["valid_event_rate"] == 1.0
    markdown = metrics_md.read_text(encoding="utf-8")
    assert "| Metric | Value |" in markdown
    assert "valid_event_rate" in markdown
    assert render_markdown(report) == markdown


# ---------------------------------------------------------------------------
# 3. Degraded extractor -> exactly predictable drops
# ---------------------------------------------------------------------------

INVALID_IDS = {"msg_02", "msg_15"}  # drop required "urgency" -> schema-invalid
UNIT_DROP_IDS = {"msg_06", "msg_12", "msg_21"}  # null out unit_id
CORR_FP_IDS = {"msg_07"}  # gold is_correction=false -> predict true
CORR_FN_IDS = {"msg_10"}  # gold is_correction=true -> predict false
STATUS_FLIP_IDS = {"msg_22"}  # reported -> confirmed
HALLU_IDS = {"msg_03"}  # append one unsupported (hallucinated) fact
TOOL_DROP_IDS = {"msg_01"}  # drop one of three expected tools

HALLUCINATED_FACT = "le pont de la rivière est effondré sur la voie ferrée"


def make_degraded_extractor(dataset):
    gold = make_gold_extractor(dataset)
    by_transcript = {entry["transcript"]: entry for entry in dataset}

    def extract(transcript):
        entry = by_transcript[transcript]
        result = gold(transcript)
        events = copy.deepcopy(result.events)
        tools = list(result.tool_suggestions)
        message_id = entry["id"]

        if message_id in INVALID_IDS:
            events[0].pop("urgency")
        if message_id in UNIT_DROP_IDS:
            for event in events:
                event["unit_id"] = None
        if message_id in CORR_FP_IDS:
            for event in events:
                event["is_correction"] = True
        if message_id in CORR_FN_IDS:
            for event in events:
                event["is_correction"] = False
        if message_id in STATUS_FLIP_IDS:
            for event in events:
                event["confirmation_status"] = "confirmed"
        if message_id in HALLU_IDS:
            events[0]["facts"].append(HALLUCINATED_FACT)
        if message_id in TOOL_DROP_IDS:
            tools = [t for t in tools if t != "firms"]

        return ExtractionResult(events=events, tool_suggestions=tools)

    return extract


def test_degraded_extractor_drops_exactly_as_expected(dataset):
    report = run_evaluation(make_degraded_extractor(dataset))
    metrics = report["metrics"]

    n_messages = len(dataset)
    total_events = sum(len(e["expected_events"]) for e in dataset)
    by_id = {entry["id"]: entry for entry in dataset}

    # Sanity: mutation targets exist and are disjoint where it matters.
    all_ids = set(by_id)
    for ids in (
        INVALID_IDS,
        UNIT_DROP_IDS,
        CORR_FP_IDS,
        CORR_FN_IDS,
        STATUS_FLIP_IDS,
        HALLU_IDS,
        TOOL_DROP_IDS,
    ):
        assert ids <= all_ids

    # valid_event_rate: exactly one event per INVALID_IDS message broken.
    invalid_events = len(INVALID_IDS)
    assert metrics["valid_event_rate"] == pytest.approx(
        (total_events - invalid_events) / total_events
    )

    # unit_accuracy: every event of UNIT_DROP_IDS whose gold unit is set fails.
    unit_errors = sum(
        1
        for mid in UNIT_DROP_IDS
        for event in by_id[mid]["expected_events"]
        if event["unit_id"] is not None
    )
    assert unit_errors > 0
    assert metrics["unit_accuracy"] == pytest.approx(
        (total_events - unit_errors) / total_events
    )

    # location_accuracy untouched by any mutation.
    assert metrics["location_accuracy"] == 1.0

    # Correction detection: gold correction events, minus one FN, plus one FP.
    gold_corrections = sum(
        1
        for entry in dataset
        for event in entry["expected_events"]
        if event["is_correction"]
    )
    fn = sum(
        1
        for mid in CORR_FN_IDS
        for event in by_id[mid]["expected_events"]
        if event["is_correction"]
    )
    fp = sum(
        1
        for mid in CORR_FP_IDS
        for event in by_id[mid]["expected_events"]
        if not event["is_correction"]
    )
    tp = gold_corrections - fn
    assert fn == 1 and fp == 1 and gold_corrections >= 4
    assert metrics["correction_precision"] == pytest.approx(tp / (tp + fp))
    assert metrics["correction_recall"] == pytest.approx(tp / (tp + fn))

    # confirmation_status_accuracy: exactly the STATUS_FLIP_IDS events fail
    # (their gold status is not already "confirmed").
    status_errors = sum(
        1
        for mid in STATUS_FLIP_IDS
        for event in by_id[mid]["expected_events"]
        if event["confirmation_status"] != "confirmed"
    )
    assert status_errors == 1
    assert metrics["confirmation_status_accuracy"] == pytest.approx(
        (total_events - status_errors) / total_events
    )

    # tool_suggestion_jaccard: msg_01 drops from 3/3 to 2/3, others stay 1.0.
    dropped = next(iter(TOOL_DROP_IDS))
    gold_tools = set(by_id[dropped]["expected_tool_suggestions"])
    assert "firms" in gold_tools and len(gold_tools) == 3
    expected_jaccard = ((n_messages - 1) * 1.0 + 2 / 3) / n_messages
    assert metrics["tool_suggestion_jaccard"] == pytest.approx(
        expected_jaccard
    )

    # Hallucination counter: exactly the one injected fact.
    assert metrics["unsupported_fact_count"] == len(HALLU_IDS)
    hallu_msg = next(
        m for m in report["per_message"] if m["id"] in HALLU_IDS
    )
    assert hallu_msg["unsupported_facts"] == [HALLUCINATED_FACT]

    assert metrics["extraction_failures"] == 0


def test_crashing_extractor_counts_as_failure(dataset):
    gold = make_gold_extractor(dataset)
    crash_on = dataset[0]["transcript"]

    def extract(transcript):
        if transcript == crash_on:
            raise RuntimeError("model exploded")
        return gold(transcript)

    report = run_evaluation(extract)
    metrics = report["metrics"]
    assert metrics["extraction_failures"] == 1
    # The failed message's expected events count as fully missed.
    failed_events = len(dataset[0]["expected_events"])
    total_events = sum(len(e["expected_events"]) for e in dataset)
    assert metrics["unit_accuracy"] == pytest.approx(
        (total_events - failed_events) / total_events
    )
