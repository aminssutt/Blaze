"""BLAZE evaluation runner for the Radio Intelligence extraction (issue #19).

Evaluates any pluggable extractor against the labeled dataset
``data/evaluation/radio_messages.jsonl``. The real Gemma agent gets plugged
in at issue #20; until then the reference gold extractor (built from the
labels themselves) serves as the calibration baseline.

Pluggable interface
-------------------
An extractor is a callable ``extract(transcript: str) -> ExtractionResult``.
For convenience the callable may also return:

* a list of RadioEvent dicts (tool suggestions assumed empty),
* a tuple ``(events, tool_suggestions)``,
* a dict ``{"events": [...], "tool_suggestions": [...]}``.

Metrics (the ONLY source of numbers for any write-up — never invent them)
-------------------------------------------------------------------------
* valid_event_rate            — predicted events valid against radio_event.schema.json
* unit_accuracy               — unit_id correct per expected event (null == null counts)
* location_accuracy           — location/road correct per expected event
* correction_precision/recall — detection of is_correction=true events
* confirmation_status_accuracy
* tool_suggestion_jaccard     — mean per-message Jaccard vs expected tool set
* unsupported_fact_count      — predicted facts with no support in the gold facts

Outputs ``metrics.json`` and ``metrics.md`` when ``output_dir`` is given.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Sequence

import jsonschema

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET_PATH = REPO_ROOT / "data" / "evaluation" / "radio_messages.jsonl"
DEFAULT_SCHEMA_PATH = (
    REPO_ROOT / "contracts" / "schemas" / "radio_event.schema.json"
)

# Allowlisted deterministic tools (see contracts/schemas/tool_request.schema.json
# and the tools/ directory).
TOOL_ALLOWLIST = frozenset(
    {"weather", "elevation", "firms", "cadastre", "osm", "routing", "resources"}
)

# A predicted fact counts as supported when its token Jaccard overlap with at
# least one gold fact of the same message reaches this threshold.
FACT_SUPPORT_JACCARD = 0.5


@dataclass
class ExtractionResult:
    """Normalized output of a pluggable extractor for one transcript."""

    events: list[dict] = field(default_factory=list)
    tool_suggestions: list[str] = field(default_factory=list)


ExtractorFn = Callable[[str], "ExtractionResult | list | tuple | dict"]


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------

def load_dataset(path: Path | str = DEFAULT_DATASET_PATH) -> list[dict]:
    """Load the JSONL dataset, one labeled radio message per line."""
    entries: list[dict] = []
    with open(path, encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                entries.append(json.loads(raw))
            except json.JSONDecodeError as exc:  # pragma: no cover - guard
                raise ValueError(
                    f"{path}: invalid JSON on line {line_number}: {exc}"
                ) from exc
    return entries


def load_schema(path: Path | str = DEFAULT_SCHEMA_PATH) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

def _strip_accents(text: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFD", text)
        if unicodedata.category(char) != "Mn"
    )


def normalize_text(value: str | None) -> str | None:
    """Lowercase, accent-fold, strip punctuation, collapse whitespace."""
    if value is None:
        return None
    text = _strip_accents(value.lower())
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_unit(value: str | None) -> str | None:
    """Normalize unit ids so 'Alpha 3', 'alpha_3' and 'alpha-3' all match."""
    if value is None:
        return None
    text = _strip_accents(value.lower())
    text = re.sub(r"[\s_]+", "-", text.strip())
    text = re.sub(r"[^\w-]", "", text)
    return text or None


def _tokens(value: str) -> set[str]:
    normalized = normalize_text(value) or ""
    return set(normalized.split())


def fact_supported(predicted_fact: str, gold_facts: Iterable[str]) -> bool:
    """True when the predicted fact overlaps enough with any gold fact."""
    pred_tokens = _tokens(predicted_fact)
    if not pred_tokens:
        return False
    for gold in gold_facts:
        gold_tokens = _tokens(gold)
        if not gold_tokens:
            continue
        union = pred_tokens | gold_tokens
        jaccard = len(pred_tokens & gold_tokens) / len(union)
        if jaccard >= FACT_SUPPORT_JACCARD:
            return True
        if pred_tokens <= gold_tokens or gold_tokens <= pred_tokens:
            return True
    return False


def jaccard_similarity(a: Sequence[str], b: Sequence[str]) -> float:
    """Jaccard over normalized tool names. Both empty -> 1.0."""
    set_a = {t.strip().lower() for t in a if t and t.strip()}
    set_b = {t.strip().lower() for t in b if t and t.strip()}
    if not set_a and not set_b:
        return 1.0
    union = set_a | set_b
    return len(set_a & set_b) / len(union)


# ---------------------------------------------------------------------------
# Extractor output coercion
# ---------------------------------------------------------------------------

def coerce_extraction(raw: object) -> ExtractionResult:
    """Accept the documented output shapes and normalize them."""
    if isinstance(raw, ExtractionResult):
        return raw
    if isinstance(raw, tuple) and len(raw) == 2:
        events, tools = raw
        return ExtractionResult(list(events or []), list(tools or []))
    if isinstance(raw, dict):
        return ExtractionResult(
            list(raw.get("events") or []),
            list(raw.get("tool_suggestions") or []),
        )
    if isinstance(raw, list):
        return ExtractionResult(list(raw), [])
    raise TypeError(
        f"Unsupported extractor output type: {type(raw).__name__}"
    )


# ---------------------------------------------------------------------------
# Event alignment
# ---------------------------------------------------------------------------

def _match_score(expected: dict, predicted: dict) -> float:
    """Similarity used to align a predicted event with a gold event."""
    if not isinstance(predicted, dict):
        return 0.0
    score = 0.0
    if predicted.get("event_type") == expected.get("event_type"):
        score += 2.0
    gold_facts = expected.get("facts") or []
    pred_facts = predicted.get("facts") or []
    if pred_facts and gold_facts:
        supported = sum(1 for f in pred_facts if fact_supported(f, gold_facts))
        score += supported / max(len(pred_facts), 1)
    exp_loc = normalize_text(expected.get("location_reference"))
    pred_loc = normalize_text(predicted.get("location_reference"))
    if exp_loc is not None and exp_loc == pred_loc:
        score += 0.5
    return score


def align_events(
    expected_events: list[dict], predicted_events: list[dict]
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Greedy one-to-one alignment of expected -> predicted events.

    Returns (matched_pairs, unmatched_expected_idx, unmatched_predicted_idx).
    """
    used: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for exp_idx, expected in enumerate(expected_events):
        best_idx, best_score = None, 0.0
        for pred_idx, predicted in enumerate(predicted_events):
            if pred_idx in used:
                continue
            score = _match_score(expected, predicted)
            if score > best_score:
                best_idx, best_score = pred_idx, score
        if best_idx is not None and best_score > 0.0:
            used.add(best_idx)
            pairs.append((exp_idx, best_idx))
    matched_expected = {e for e, _ in pairs}
    unmatched_expected = [
        i for i in range(len(expected_events)) if i not in matched_expected
    ]
    unmatched_predicted = [
        i for i in range(len(predicted_events)) if i not in used
    ]
    return pairs, unmatched_expected, unmatched_predicted


# ---------------------------------------------------------------------------
# Evaluation core
# ---------------------------------------------------------------------------

def run_evaluation(
    extract_fn: ExtractorFn,
    dataset_path: Path | str = DEFAULT_DATASET_PATH,
    schema_path: Path | str = DEFAULT_SCHEMA_PATH,
    output_dir: Path | str | None = None,
) -> dict:
    """Run the extractor over the dataset and compute all metrics."""
    dataset = load_dataset(dataset_path)
    schema = load_schema(schema_path)
    validator = jsonschema.Draft7Validator(schema)

    total_expected_events = 0
    total_predicted_events = 0
    valid_predicted_events = 0
    extraction_failures = 0

    unit_correct = 0
    location_correct = 0
    status_correct = 0

    correction_tp = 0
    correction_fp = 0
    correction_fn = 0

    tool_jaccards: list[float] = []
    unsupported_fact_count = 0
    total_predicted_facts = 0

    per_message: list[dict] = []
    by_category: dict[str, int] = {}

    for entry in dataset:
        message_id = entry["id"]
        category = entry.get("category", "uncategorized")
        by_category[category] = by_category.get(category, 0) + 1
        expected_events = entry["expected_events"]
        expected_tools = entry.get("expected_tool_suggestions", [])
        total_expected_events += len(expected_events)

        message_report: dict = {"id": message_id, "category": category}

        try:
            extraction = coerce_extraction(extract_fn(entry["transcript"]))
        except Exception as exc:  # noqa: BLE001 - extractor is untrusted
            extraction_failures += 1
            correction_fn += sum(
                1 for e in expected_events if e.get("is_correction")
            )
            tool_jaccards.append(jaccard_similarity([], expected_tools))
            message_report.update(
                {"error": f"{type(exc).__name__}: {exc}", "predicted_events": 0}
            )
            per_message.append(message_report)
            continue

        predicted_events = extraction.events
        total_predicted_events += len(predicted_events)

        schema_errors: list[str] = []
        for event in predicted_events:
            if isinstance(event, dict):
                errors = sorted(validator.iter_errors(event), key=str)
            else:
                errors = [None]
            if errors:
                first = errors[0]
                schema_errors.append(
                    first.message if first is not None else "not an object"
                )
            else:
                valid_predicted_events += 1

        pairs, unmatched_exp, unmatched_pred = align_events(
            expected_events, predicted_events
        )

        message_unit_correct = 0
        message_status_correct = 0
        message_location_correct = 0

        for exp_idx, pred_idx in pairs:
            expected = expected_events[exp_idx]
            predicted = predicted_events[pred_idx]

            if normalize_unit(expected.get("unit_id")) == normalize_unit(
                predicted.get("unit_id")
            ):
                message_unit_correct += 1
            if normalize_text(
                expected.get("location_reference")
            ) == normalize_text(predicted.get("location_reference")):
                message_location_correct += 1
            if expected.get("confirmation_status") == predicted.get(
                "confirmation_status"
            ):
                message_status_correct += 1

            exp_corr = bool(expected.get("is_correction"))
            pred_corr = bool(predicted.get("is_correction"))
            if exp_corr and pred_corr:
                correction_tp += 1
            elif pred_corr and not exp_corr:
                correction_fp += 1
            elif exp_corr and not pred_corr:
                correction_fn += 1

        for exp_idx in unmatched_exp:
            if expected_events[exp_idx].get("is_correction"):
                correction_fn += 1
        for pred_idx in unmatched_pred:
            predicted = predicted_events[pred_idx]
            if isinstance(predicted, dict) and predicted.get("is_correction"):
                correction_fp += 1

        unit_correct += message_unit_correct
        location_correct += message_location_correct
        status_correct += message_status_correct

        gold_facts = [
            fact for event in expected_events for fact in event.get("facts", [])
        ]
        message_unsupported: list[str] = []
        for event in predicted_events:
            if not isinstance(event, dict):
                continue
            for fact in event.get("facts", []) or []:
                total_predicted_facts += 1
                if not fact_supported(fact, gold_facts):
                    message_unsupported.append(fact)
        unsupported_fact_count += len(message_unsupported)

        tool_jaccard = jaccard_similarity(
            extraction.tool_suggestions, expected_tools
        )
        tool_jaccards.append(tool_jaccard)

        message_report.update(
            {
                "predicted_events": len(predicted_events),
                "expected_events": len(expected_events),
                "matched_events": len(pairs),
                "schema_errors": schema_errors,
                "unit_correct": message_unit_correct,
                "location_correct": message_location_correct,
                "status_correct": message_status_correct,
                "tool_jaccard": round(tool_jaccard, 4),
                "unsupported_facts": message_unsupported,
            }
        )
        per_message.append(message_report)

    def _safe_ratio(numerator: float, denominator: float) -> float:
        return numerator / denominator if denominator else 1.0

    correction_precision = _safe_ratio(
        correction_tp, correction_tp + correction_fp
    )
    correction_recall = _safe_ratio(
        correction_tp, correction_tp + correction_fn
    )
    correction_f1 = (
        2 * correction_precision * correction_recall
        / (correction_precision + correction_recall)
        if (correction_precision + correction_recall) > 0
        else 0.0
    )

    metrics = {
        "valid_event_rate": _safe_ratio(
            valid_predicted_events, total_predicted_events
        ),
        "unit_accuracy": _safe_ratio(unit_correct, total_expected_events),
        "location_accuracy": _safe_ratio(
            location_correct, total_expected_events
        ),
        "correction_precision": correction_precision,
        "correction_recall": correction_recall,
        "correction_f1": correction_f1,
        "confirmation_status_accuracy": _safe_ratio(
            status_correct, total_expected_events
        ),
        "tool_suggestion_jaccard": (
            sum(tool_jaccards) / len(tool_jaccards) if tool_jaccards else 1.0
        ),
        "unsupported_fact_count": unsupported_fact_count,
        "unsupported_fact_rate": _safe_ratio(
            unsupported_fact_count, total_predicted_facts
        )
        if total_predicted_facts
        else 0.0,
        "extraction_failures": extraction_failures,
    }

    report = {
        "dataset": {
            "path": str(dataset_path),
            "messages": len(dataset),
            "expected_events": total_expected_events,
            "by_category": dict(sorted(by_category.items())),
        },
        "counts": {
            "total_predicted_events": total_predicted_events,
            "valid_predicted_events": valid_predicted_events,
            "total_predicted_facts": total_predicted_facts,
            "correction_tp": correction_tp,
            "correction_fp": correction_fp,
            "correction_fn": correction_fn,
        },
        "metrics": metrics,
        "per_message": per_message,
    }

    if output_dir is not None:
        write_reports(report, Path(output_dir))

    return report


# ---------------------------------------------------------------------------
# Report writers
# ---------------------------------------------------------------------------

def render_markdown(report: dict) -> str:
    """Render metrics as a markdown table (dataset summary + metrics)."""
    dataset = report["dataset"]
    metrics = report["metrics"]

    lines = [
        "# BLAZE radio extraction evaluation",
        "",
        f"Dataset: `{dataset['path']}` — {dataset['messages']} messages, "
        f"{dataset['expected_events']} expected events.",
        "",
        "## Messages by category",
        "",
        "| Category | Messages |",
        "| --- | ---: |",
    ]
    for category, count in dataset["by_category"].items():
        lines.append(f"| {category} | {count} |")

    lines += [
        "",
        "## Metrics",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
    ]
    for key, value in metrics.items():
        if isinstance(value, float):
            lines.append(f"| {key} | {value:.4f} |")
        else:
            lines.append(f"| {key} | {value} |")
    lines.append("")
    return "\n".join(lines)


def write_reports(report: dict, output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "metrics.json"
    md_path = output_dir / "metrics.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


# ---------------------------------------------------------------------------
# Reference gold extractor (calibration baseline; real agent lands in #20)
# ---------------------------------------------------------------------------

def build_gold_event(entry: dict, expected: dict, index: int) -> dict:
    """Materialize a full schema-valid RadioEvent from one gold label."""
    return {
        "event_id": f"{entry['id']}-e{index + 1}",
        "audio_id": entry["id"],
        "unit_id": expected.get("unit_id"),
        "event_type": expected["event_type"],
        "location_reference": expected.get("location_reference"),
        "facts": list(expected.get("facts", [])),
        "urgency": expected["urgency"],
        "confidence": 1.0,
        "confirmation_status": expected["confirmation_status"],
        "is_correction": bool(expected.get("is_correction")),
        "corrects_event_id": None,
        "uncertainties": [],
        "evidence_text": entry["transcript"],
        "observed_at": "2026-07-25T10:00:00Z",
        "source_type": "human_report",
    }


def make_gold_extractor(dataset: list[dict]) -> ExtractorFn:
    """Perfect extractor replaying the gold labels — the 100% baseline."""
    by_transcript = {entry["transcript"]: entry for entry in dataset}

    def extract(transcript: str) -> ExtractionResult:
        entry = by_transcript[transcript]
        events = [
            build_gold_event(entry, expected, i)
            for i, expected in enumerate(entry["expected_events"])
        ]
        return ExtractionResult(
            events=events,
            tool_suggestions=list(entry.get("expected_tool_suggestions", [])),
        )

    return extract


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate a radio-event extractor against the gold dataset."
    )
    parser.add_argument(
        "--dataset", default=str(DEFAULT_DATASET_PATH), help="JSONL dataset path"
    )
    parser.add_argument(
        "--schema", default=str(DEFAULT_SCHEMA_PATH), help="RadioEvent schema"
    )
    parser.add_argument(
        "--output-dir",
        default=str(Path(__file__).resolve().parent / "results"),
        help="Directory for metrics.json / metrics.md",
    )
    args = parser.parse_args(argv)

    dataset = load_dataset(args.dataset)
    report = run_evaluation(
        make_gold_extractor(dataset),
        dataset_path=args.dataset,
        schema_path=args.schema,
        output_dir=args.output_dir,
    )
    print(render_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
