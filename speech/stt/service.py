"""BLAZE — production STT service (issue #12).

Local speech-to-text on faster-whisper, emitting ``TranscriptResult`` dicts
that conform to the frozen contract ``contracts/schemas/transcript_result.schema.json``.

Design notes
------------
* Model choices follow the #3 hello-world: ``small`` model, CPU + int8 by
  default, ``av==13.1.0`` pinned (Windows Smart App Control blocks newer
  unsigned av wheels). ``device="cuda"`` is ready via ``WHISPER_DEVICE``.
* Domain lexicon: ``transcribe`` passes a firefighter ``initial_prompt``
  (callsigns, D17, CCF, hangar, ...) to bias decoding and reduce the
  "dédicite"/"Jean-Garre" style mis-hearings observed in #3 on the
  radio-degraded audios. Pass ``initial_prompt=None`` to disable.

Thread-safety of concurrent transcription (verified for #12)
-----------------------------------------------------------
``WhisperModel.transcribe`` delegates inference to CTranslate2, whose model
replicas are safe to call from multiple Python threads. However, with the
default ``num_workers=1`` there is a single execution worker, so concurrent
calls are *safe but serialized* at the C++ level (no parallel speedup).
To get true parallelism from ONE loaded model, the model must be created
with ``num_workers > 1`` (maps to CTranslate2 ``inter_threads``: a pool of
execution contexts sharing the same weights — near-zero extra RAM, unlike
an instance pool). ``SttService`` therefore creates its single model with
``num_workers = max_workers`` and fans out with a ``ThreadPoolExecutor``.
No instance pool or semaphore is needed. The measured concurrent-vs-
sequential speedup is asserted in ``test_stt_service.py``.
"""

from __future__ import annotations

import logging
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

logger = logging.getLogger("blaze.stt")

REPO_ROOT = Path(__file__).resolve().parents[2]

#: Scenario lexicon (issue #12): callsigns, radio shorthand and hazard terms
#: used as faster-whisper ``initial_prompt`` to bias decoding on degraded audio.
FIREFIGHTER_INITIAL_PROMPT = (
    "Radio sapeurs-pompiers. Unités : Alpha 3, Bravo 2, Charlie 1, PC, CCF. "
    "Route D17, hangar, point d'eau, véhicules légers, bouteilles de gaz, "
    "explosion, fumée."
)

#: Sentinel: "use the service default prompt" (so callers can pass None to disable).
_USE_DEFAULT_PROMPT = object()

DEFAULT_MODEL_SIZE = "small"
DEFAULT_LANGUAGE = "fr"
DEFAULT_DEVICE = "cpu"
DEFAULT_MAX_WORKERS = 4


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str
    confidence: float | None = None


@dataclass
class TranscriptResult:
    """In-memory mirror of ``transcript_result.schema.json``."""

    audio_id: str
    text: str
    language: str
    started_at: str
    completed_at: str
    latency_ms: float
    model_name: str
    fallback_used: bool
    segments: list[TranscriptSegment] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Schema-conformant plain dict (JSON-serializable)."""
        return asdict(self)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SttService:
    """Local faster-whisper STT service.

    Parameters (all fall back to environment variables):
        model_size:   Whisper size, env ``WHISPER_MODEL_SIZE`` (default "small").
        language:     forced language, env ``WHISPER_LANGUAGE`` (default "fr").
        device:       "cpu" or "cuda", env ``WHISPER_DEVICE`` (default "cpu").
        compute_type: env ``WHISPER_COMPUTE_TYPE`` (default "int8" on cpu,
                      "float16" on cuda).
        max_workers:  parallel transcription lanes, env ``WHISPER_MAX_WORKERS``
                      (default 4). Also the model's ``num_workers`` so that a
                      single loaded model serves concurrent calls in parallel
                      (see module docstring on thread safety).
    """

    def __init__(
        self,
        model_size: str | None = None,
        language: str | None = None,
        device: str | None = None,
        compute_type: str | None = None,
        max_workers: int | None = None,
    ) -> None:
        self.model_size = model_size or os.environ.get("WHISPER_MODEL_SIZE", DEFAULT_MODEL_SIZE)
        self.language = language or os.environ.get("WHISPER_LANGUAGE", DEFAULT_LANGUAGE)
        self.device = device or os.environ.get("WHISPER_DEVICE", DEFAULT_DEVICE)
        default_compute = "float16" if self.device == "cuda" else "int8"
        self.compute_type = compute_type or os.environ.get("WHISPER_COMPUTE_TYPE", default_compute)
        self.max_workers = int(
            max_workers or os.environ.get("WHISPER_MAX_WORKERS", DEFAULT_MAX_WORKERS)
        )
        self.model_name = f"faster-whisper-{self.model_size}"
        self._model = None  # lazy

    # ------------------------------------------------------------------ model

    @property
    def model(self):
        """Lazily-loaded single WhisperModel shared by all calls."""
        if self._model is None:
            from faster_whisper import WhisperModel

            t0 = time.perf_counter()
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
                num_workers=self.max_workers,
            )
            logger.info(
                "Loaded %s (device=%s, compute_type=%s, num_workers=%d) in %.2fs",
                self.model_name,
                self.device,
                self.compute_type,
                self.max_workers,
                time.perf_counter() - t0,
            )
        return self._model

    # -------------------------------------------------------------- transcribe

    def transcribe(
        self,
        audio_path: str | Path,
        audio_id: str,
        initial_prompt: Any = _USE_DEFAULT_PROMPT,
    ) -> TranscriptResult:
        """Transcribe one audio file into a schema-conformant TranscriptResult.

        Raises on unreadable/missing audio — the fallback policy lives in
        ``transcribe_batch`` where a reference transcript is available.
        """
        audio_path = Path(audio_path)
        if not audio_path.is_file():
            raise FileNotFoundError(f"audio file not found: {audio_path}")

        prompt = (
            FIREFIGHTER_INITIAL_PROMPT if initial_prompt is _USE_DEFAULT_PROMPT else initial_prompt
        )

        started_at = _utc_now_iso()
        t0 = time.perf_counter()
        segments_iter, info = self.model.transcribe(
            str(audio_path),
            language=self.language,
            beam_size=5,
            initial_prompt=prompt,
        )
        raw_segments = list(segments_iter)  # generator: this runs the decode
        latency_ms = (time.perf_counter() - t0) * 1000.0
        completed_at = _utc_now_iso()

        segments = [
            TranscriptSegment(
                start=float(seg.start),
                end=float(seg.end),
                text=seg.text.strip(),
                confidence=self._segment_confidence(seg),
            )
            for seg in raw_segments
        ]
        text = " ".join(seg.text for seg in segments).strip()

        return TranscriptResult(
            audio_id=audio_id,
            text=text,
            language=info.language or self.language,
            segments=segments,
            started_at=started_at,
            completed_at=completed_at,
            latency_ms=round(latency_ms, 1),
            model_name=self.model_name,
            fallback_used=False,
        )

    @staticmethod
    def _segment_confidence(seg) -> float | None:
        """Map faster-whisper avg_logprob to a [0, 1] confidence."""
        avg_logprob = getattr(seg, "avg_logprob", None)
        if avg_logprob is None:
            return None
        return round(min(1.0, max(0.0, math.exp(avg_logprob))), 4)

    # ------------------------------------------------------------------- batch

    def transcribe_batch(
        self,
        manifest_items: Sequence[dict[str, Any]],
        variant: str = "radio",
        max_workers: int | None = None,
        on_result: Callable[[TranscriptResult], None] | None = None,
        audio_root: str | Path | None = None,
        initial_prompt: Any = _USE_DEFAULT_PROMPT,
    ) -> list[TranscriptResult]:
        """Concurrently transcribe manifest items with ONE loaded model.

        Args:
            manifest_items: entries shaped like ``data/audio/manifest.json``
                (``audio_id``, ``clean_path``/``radio_path``,
                ``reference_transcript``).
            variant: "radio" or "clean" — selects which path to transcribe.
            max_workers: thread fan-out (default: service ``max_workers``).
            on_result: optional callback fired as each result COMPLETES
                (completion order, not scenario order).
            audio_root: base dir for the manifest's relative paths
                (default: repo root).
            initial_prompt: forwarded to ``transcribe`` (None disables the
                domain lexicon).

        Returns:
            Results in the same order as ``manifest_items`` (scenario order),
            regardless of completion order. An item that fails for any reason
            yields a ``fallback_used=True`` result carrying the manifest's
            ``reference_transcript`` — this method never raises for a bad item.
        """
        if variant not in ("radio", "clean"):
            raise ValueError(f"variant must be 'radio' or 'clean', got {variant!r}")

        root = Path(audio_root) if audio_root is not None else REPO_ROOT
        workers = max_workers or self.max_workers
        path_key = f"{variant}_path"

        # Ensure the model is loaded once, before the threads race to build it.
        _ = self.model

        def _one(item: dict[str, Any]) -> TranscriptResult:
            audio_id = item.get("audio_id", "unknown")
            started_at = _utc_now_iso()
            t0 = time.perf_counter()
            try:
                rel = item[path_key]
                result = self.transcribe(root / rel, audio_id, initial_prompt=initial_prompt)
                if not result.text:
                    raise ValueError("empty transcript")
            except Exception:
                logger.exception(
                    "Transcription failed for %s (%s variant); using reference fallback",
                    audio_id,
                    variant,
                )
                result = TranscriptResult(
                    audio_id=audio_id,
                    text=item.get("reference_transcript", ""),
                    language=self.language,
                    segments=[],
                    started_at=started_at,
                    completed_at=_utc_now_iso(),
                    latency_ms=round((time.perf_counter() - t0) * 1000.0, 1),
                    model_name=self.model_name,
                    fallback_used=True,
                )
            if on_result is not None:
                try:
                    on_result(result)
                except Exception:
                    logger.exception("on_result callback raised for %s", result.audio_id)
            return result

        with ThreadPoolExecutor(max_workers=workers) as pool:
            # pool.map preserves input order in the returned iterable while the
            # underlying work runs concurrently; on_result still fires in
            # completion order for streaming consumers.
            results = list(pool.map(_one, manifest_items))
        return results


def load_manifest(manifest_path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load ``data/audio/manifest.json`` (scenario order)."""
    import json

    path = Path(manifest_path) if manifest_path else REPO_ROOT / "data" / "audio" / "manifest.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
