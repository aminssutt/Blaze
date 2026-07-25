"""BLAZE #12 — measure the real effect of the firefighter initial_prompt.

Transcribes the 5 radio-degraded audios twice (with and without the domain
initial_prompt) and prints both transcripts side by side plus a crude
word-level similarity to the reference transcript, so the PR can report the
HONEST effect of the lexicon biasing.

Run (from repo root):
    speech/stt/.venv/Scripts/python speech/stt/compare_initial_prompt.py
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from service import FIREFIGHTER_INITIAL_PROMPT, SttService, load_manifest


def _norm_words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9]+", text)


def word_f1(hyp: str, ref: str) -> float:
    """Bag-of-words F1 vs the reference (accent/case-insensitive)."""
    h, r = _norm_words(hyp), _norm_words(ref)
    if not h or not r:
        return 0.0
    from collections import Counter

    overlap = sum((Counter(h) & Counter(r)).values())
    precision = overlap / len(h)
    recall = overlap / len(r)
    return 0.0 if overlap == 0 else 2 * precision * recall / (precision + recall)


def main() -> int:
    items = load_manifest()
    service = SttService()
    print(f"initial_prompt = {FIREFIGHTER_INITIAL_PROMPT!r}\n")

    with_prompt = service.transcribe_batch(items, variant="radio")
    without_prompt = service.transcribe_batch(items, variant="radio", initial_prompt=None)

    total_on = total_off = 0.0
    for item, on, off in zip(items, with_prompt, without_prompt):
        ref = item["reference_transcript"]
        f1_on, f1_off = word_f1(on.text, ref), word_f1(off.text, ref)
        total_on += f1_on
        total_off += f1_off
        print(f"=== {item['audio_id']} ({item['speaker_hint']}) ===")
        print(f"  REF          : {ref}")
        print(f"  WITH  prompt : (F1={f1_on:.3f}) {on.text}")
        print(f"  WITHOUT      : (F1={f1_off:.3f}) {off.text}")
        print()

    n = len(items)
    print(f"Mean word-F1 vs reference — WITH prompt: {total_on / n:.3f} | WITHOUT: {total_off / n:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
