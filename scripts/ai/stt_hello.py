"""BLAZE — faster-whisper hello-world (issue #3).

Transcribes one French source audio from the repo with the `small` model,
prints the full text, per-segment timings, and measured latency.

Run (from repo root, inside the speech/stt venv):
    speech/stt/.venv-stt/Scripts/python scripts/ai/stt_hello.py [path/to/audio]

Environment:
    WHISPER_MODEL_SIZE  model size (default: small)

CPU-only machines are fine: compute_type falls back to int8.
The model is downloaded to the local HF cache on first run, then works offline.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from faster_whisper import WhisperModel

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AUDIO = REPO_ROOT / "data" / "audio" / "source" / "audio_01_alpha_initial.m4a"


def main() -> int:
    audio_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_AUDIO
    if not audio_path.exists():
        print(f"ERROR: audio file not found: {audio_path}", file=sys.stderr)
        return 1

    model_size = os.environ.get("WHISPER_MODEL_SIZE", "small")

    print(f"Audio       : {audio_path}")
    print(f"Model       : {model_size} (device=cpu, compute_type=int8)")

    t0 = time.perf_counter()
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    load_s = time.perf_counter() - t0
    print(f"Model load  : {load_s:.2f} s")

    t1 = time.perf_counter()
    segments_iter, info = model.transcribe(str(audio_path), language="fr", beam_size=5)
    segments = list(segments_iter)  # generator: consuming it runs the actual decode
    transcribe_s = time.perf_counter() - t1

    text = " ".join(seg.text.strip() for seg in segments)

    print(f"Duration    : {info.duration:.2f} s of audio (language={info.language}, p={info.language_probability:.2f})")
    print(f"Transcribe  : {transcribe_s:.2f} s  (RTF={transcribe_s / info.duration:.2f})")
    print(f"Total       : {load_s + transcribe_s:.2f} s (load + transcribe)")
    print()
    print("--- Segments ---")
    for seg in segments:
        print(f"[{seg.start:6.2f} -> {seg.end:6.2f}] {seg.text.strip()}")
    print()
    print("--- Transcription ---")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
