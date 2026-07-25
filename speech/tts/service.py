"""Piper TTS service — one WAV per unit, fully offline (issue #35).

Loads the Piper voice from PIPER_VOICE_PATH once, synthesizes French dispatch
messages to WAV files, measures latency, and degrades to a text-only fallback
(never raises) when TTS is unavailable or fails.
"""

from __future__ import annotations

import os
import time
import wave
from pathlib import Path
from typing import Optional

_REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT_DIR = _REPO_ROOT / "speech" / "tts" / "output"


class TTSService:
    def __init__(
        self,
        voice_path: Optional[str] = None,
        output_dir: Path = DEFAULT_OUTPUT_DIR,
    ) -> None:
        raw = voice_path or os.environ.get("PIPER_VOICE_PATH", "")
        self.voice_path = self._resolve(raw) if raw else None
        self.output_dir = output_dir
        self._voice = None  # lazy-loaded PiperVoice

    @staticmethod
    def _resolve(raw: str) -> Path:
        p = Path(raw)
        return p if p.is_absolute() else _REPO_ROOT / p

    @property
    def available(self) -> bool:
        return self.voice_path is not None and self.voice_path.is_file()

    def _load_voice(self):
        if self._voice is None:
            from piper import PiperVoice  # imported lazily: optional dependency

            self._voice = PiperVoice.load(str(self.voice_path))
        return self._voice

    def synthesize(self, text: str, filename: str) -> dict:
        """Synthesize `text` to `<output_dir>/<filename>`. Never raises.

        Returns {status: "success"|"fallback", wav_path, latency_ms,
        fallback_text} — on fallback the caller displays the text instead.
        """
        started = time.perf_counter()
        try:
            if not self.available:
                raise FileNotFoundError(f"Piper voice not found: {self.voice_path}")
            voice = self._load_voice()
            self.output_dir.mkdir(parents=True, exist_ok=True)
            out_path = self.output_dir / filename
            with wave.open(str(out_path), "wb") as wav_file:
                voice.synthesize_wav(text, wav_file)
            return {
                "status": "success",
                "wav_path": str(out_path.relative_to(_REPO_ROOT)),
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "fallback_text": None,
            }
        except Exception as exc:  # TTS must never crash the dispatch pipeline
            return {
                "status": "fallback",
                "wav_path": None,
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "fallback_text": text,
                "error": f"{type(exc).__name__}: {exc}",
            }
