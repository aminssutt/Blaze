#!/usr/bin/env python3
"""BLAZE — REAL end-to-end run over ALL FIVE audios (issue #53).

Executes backend.orchestrator.scenario_pipeline.ScenarioPipeline against the
LIVE local stack (vLLM Gemma on localhost:8000, faster-whisper batch STT, real
tool layer, Piper TTS): concurrent transcription of the 5 audios, scenario-order
radio processing, budgeted incremental planning (3 cycles), D17 correction,
hazard confirmation, exclusion perimeter, dispatch + WAVs. Writes a full JSON
report (stage latencies, measured concurrency proof, events, narrative beats).

Usage (repo root, venv with all module requirements):

    python scripts/ai/run_e2e_five_audios.py [--variant radio]
        [--out artifacts/e2e/report.json] [--max-revisions-per-cycle 1]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from run_e2e_one_audio import load_dotenv  # noqa: E402 — same dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=("radio", "clean"), default="radio")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--max-revisions-per-cycle", type=int, default=None)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    load_dotenv(REPO_ROOT / ".env")

    from backend.orchestrator.incident_pipeline import PipelineFailure
    from backend.orchestrator.scenario_pipeline import ScenarioPipeline

    output_dir = args.output_dir or (REPO_ROOT / "artifacts" / "e2e")
    pipeline = ScenarioPipeline(
        variant=args.variant,
        output_dir=output_dir,
        max_revisions_per_cycle=args.max_revisions_per_cycle,
    )

    print(f"== BLAZE E2E — FULL SCENARIO, {len(pipeline.items)} audios ({args.variant}) ==")
    print(f"   incident_id : {pipeline.incident_id}")
    print(f"   vLLM        : {pipeline.client.base_url}  model={pipeline.client.model}")
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

    out_path = args.out or (output_dir / f"{pipeline.incident_id}_report.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )

    _print_summary(report, wall_s, out_path)
    validation = report["event_contract_validation"]
    beats = report["narrative_beats"]
    ok = (
        validation["contract_valid"]
        and report["final_state"] == "COMPLETED"
        and beats["scenario_order_respected"]
        and beats["d17_correction_verified"]
        and beats["final_plan_has_exclusion_perimeter"]
    )
    return 0 if ok else 1


async def _run(pipeline):
    try:
        return await pipeline.run()
    finally:
        await pipeline.aclose()


def _print_summary(report: dict, wall_s: float, out_path: Path) -> None:
    print("\n== RESULT ==")
    print(f"final_state          : {report['final_state']}")
    print(f"SCENARIO TOTAL       : {report['timings_s'].get('scenario_total')} s "
          f"(wall {wall_s:.2f} s)")
    proof = report["concurrency_proof"]
    print(f"stt batch wall       : {proof['stt_batch_wall_s']} s "
          f"(sequential sum {proof['stt_sequential_sum_s']} s, "
          f"gain {proof['stt_concurrency_gain_s']} s, "
          f"concurrent_proven={proof['stt_concurrent_proven']})")
    print(f"context/stt overlap  : {proof.get('context_vs_stt_overlap_s')} s ; "
          f"context/radio overlap: {proof.get('context_vs_radio_track_overlap_s')} s")
    for wave, stats in proof.get("radio_extraction_waves", {}).items():
        print(f"radio {wave:<17}: wall={stats.get('wall_s')}s "
              f"seq_sum={stats.get('sequential_sum_s')}s "
              f"gain={stats.get('concurrency_gain_s')}s "
              f"proven={stats.get('concurrent_proven')}")
    print(f"wave2/planning overlap: {proof.get('wave2_vs_planning_cycle_a_overlap_s')} s ; "
          f"llm max_concurrent: {proof.get('llm_max_concurrent_observed')}")
    print(f"tts parallel         : wall={proof['tts_parallel']['wall_s']}s "
          f"seq_sum={proof['tts_parallel']['sequential_sum_s']}s")
    for entry in report["narrative_beats"]["processed_order"]:
        print(f"  {entry['audio_id']} (t+{entry['scenario_timestamp']}s) "
              f"processed at {entry['processed_at_s']}s -> {entry['event_types']}")
    beats = report["narrative_beats"]
    print(f"order respected      : {beats['scenario_order_respected']}")
    print(f"D17 correction       : verified={beats['d17_correction_verified']} "
          f"{beats['d17_correction']}")
    print(f"explosion arc        : reported(audio_01)={beats['explosions_reported_audio_01']} "
          f"confirmed(audio_05)={beats['explosions_confirmed_in_snapshot']}")
    print(f"exclusion perimeter  : {beats['final_plan_has_exclusion_perimeter']} "
          f"({len(beats['final_plan_exclusion_perimeter_actions'])} action(s))")
    print(f"plans/reviews        : {len(report['plans'])} plan version(s), "
          f"{len(report['safety_reviews'])} review(s), "
          f"review-per-version={beats['safety_review_per_plan_version']}")
    for cyc in report["planning_cycles"]:
        print(f"  {cyc['cycle']:<8} versions={cyc['plan_versions']} "
              f"reviews={cyc['reviews']} escalated={cyc.get('escalated_to_human')}")
    for instr in report["dispatch_instructions"]:
        print(f"dispatch {instr['unit_id']:<12}: {instr['message_text'][:100]!r}")
        print(f"          wav        : {instr.get('tts_audio_path')}")
    validation = report["event_contract_validation"]
    print(f"events               : {validation['total_events']} "
          f"(contract_valid={validation['contract_valid']})")
    print("stage timings (s)    :")
    for name, seconds in report["timings_s"].items():
        print(f"    {name:<32} {seconds:>8.3f}")
    metrics = report["metrics"]
    print(f"llm calls            : {report['llm_call_log']['total_calls']} "
          f"(cloud={report['llm_call_log']['cloud_calls']}, "
          f"tokens/s={metrics.get('tokens_per_second')})")
    print("per-agent LLM        :")
    for agent, stats in report["per_agent_llm"].items():
        print(f"    {agent:<22} calls={stats['calls']} "
              f"latency_total={stats['latency_s_total']:.2f}s "
              f"tokens={stats['prompt_tokens']}+{stats['completion_tokens']}")
    print(f"\nreport written       : {out_path}")


if __name__ == "__main__":
    raise SystemExit(main())
