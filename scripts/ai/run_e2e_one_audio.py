#!/usr/bin/env python3
"""BLAZE — run the first REAL end-to-end pipeline for ONE audio (issue #52).

Executes backend.orchestrator.incident_pipeline.IncidentPipeline on one audio
of data/audio/manifest.json against the LIVE local stack (vLLM Gemma on
localhost:8000, faster-whisper STT, real tool layer, Piper TTS) and writes a
full JSON report (per-stage latencies, events, plan/review/dispatch content,
WAV paths, measured metrics).

Usage (from the repo root, inside a venv with all module requirements):

    python scripts/ai/run_e2e_one_audio.py [--audio-index 0] [--variant radio]
        [--out artifacts/e2e/report.json] [--max-revisions 2]

Environment (a repo-root .env file is loaded if present, without overriding
already-exported variables):

    VLLM_BASE_URL=http://localhost:8000
    GEMMA_MODEL_ID=google/gemma-4-E4B-it
    USE_CACHED_EXTERNAL_DATA=true
    WHISPER_LANGUAGE=fr
    PIPER_VOICE_PATH=speech/tts/piper-voices/fr_FR-siwis-medium.onnx
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, no override of exported vars."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio-index", type=int, default=0,
                        help="Index into data/audio/manifest.json (0 = audio_01).")
    parser.add_argument("--variant", choices=("radio", "clean"), default="radio")
    parser.add_argument("--out", type=Path, default=None,
                        help="Report JSON path (default artifacts/e2e/<incident>_report.json).")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="Directory for WAVs + audit JSONL (default artifacts/e2e).")
    parser.add_argument("--max-revisions", type=int, default=None)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    load_dotenv(REPO_ROOT / ".env")

    from backend.orchestrator.incident_pipeline import IncidentPipeline, PipelineFailure

    output_dir = args.output_dir or (REPO_ROOT / "artifacts" / "e2e")
    pipeline = IncidentPipeline(
        audio_index=args.audio_index,
        variant=args.variant,
        output_dir=output_dir,
        max_revisions=args.max_revisions,
    )

    print(f"== BLAZE E2E — audio index {args.audio_index} ({args.variant}) ==")
    print(f"   incident_id : {pipeline.incident_id}")
    print(f"   vLLM        : {pipeline.client.base_url}  model={pipeline.client.model}")
    print(f"   tools       : {', '.join(pipeline.registry.names())}")
    print(f"   piper voice : {pipeline.tts.voice_path} (available={pipeline.tts.available})")

    t0 = time.perf_counter()
    try:
        report = asyncio.run(_run(pipeline))
    except PipelineFailure as exc:
        print(f"\nE2E FAILED (honest failure, state machine failed over): {exc}",
              file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"\nE2E CRASHED: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
    wall_s = time.perf_counter() - t0

    out_path = args.out or (
        output_dir / f"{pipeline.incident_id}_report.json"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )

    _print_summary(report, wall_s, out_path)
    validation = report["event_contract_validation"]
    return 0 if validation["contract_valid"] and report["final_state"] == "COMPLETED" else 1


async def _run(pipeline):
    try:
        return await pipeline.run()
    finally:
        await pipeline.aclose()


def _print_summary(report: dict, wall_s: float, out_path: Path) -> None:
    print("\n== RESULT ==")
    print(f"final_state       : {report['final_state']}")
    print(f"wall time         : {wall_s:.2f} s")
    print(f"transcript        : {report['transcript']['text']!r}")
    print(f"radio events      : {len(report['radio_extraction']['events'])} "
          f"(confidence {report['radio_extraction']['confidence']:.2f})")
    print(f"tool calls        : {len(report['context']['tool_requests'])} -> "
          + ", ".join(
              f"{r['tool_name']}:{r['status']}" for r in report["context"]["tool_results"]
          ))
    for i, plan in enumerate(report["plans"], start=1):
        print(f"plan v{plan.get('version', i)}          : {plan.get('summary', '')!r}")
    for review in report["safety_reviews"]:
        print(f"safety review     : {review['status']} "
              f"({len(review.get('critical_objections', []))} objection(s))")
    print(f"approval          : {report['approval_decision']['decision']} "
          f"by {report['approval_decision']['operator_name']}")
    for instr in report["dispatch_instructions"]:
        print(f"dispatch {instr['unit_id']:<12}: {instr['message_text']!r}")
        print(f"          wav     : {instr.get('tts_audio_path')}")
    validation = report["event_contract_validation"]
    print(f"events            : {validation['total_events']} "
          f"(contract_valid={validation['contract_valid']})")
    print("stage timings (s) :")
    for name, seconds in report["timings_s"].items():
        print(f"    {name:<28} {seconds:>8.3f}")
    metrics = report["metrics"]
    print(f"gpu               : {metrics.get('gpu_name')}")
    print(f"llm calls         : {report['llm_call_log']['total_calls']} "
          f"(cloud={report['llm_call_log']['cloud_calls']}, "
          f"tokens/s={metrics.get('tokens_per_second')})")
    print("per-agent LLM (s) :")
    for agent, stats in report["per_agent_llm"].items():
        print(f"    {agent:<22} calls={stats['calls']} "
              f"latency_total={stats['latency_s_total']:.2f}s "
              f"tokens={stats['prompt_tokens']}+{stats['completion_tokens']}")
    print(f"\nreport written    : {out_path}")


if __name__ == "__main__":
    raise SystemExit(main())
