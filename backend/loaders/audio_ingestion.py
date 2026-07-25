"""Audio Ingestion Service (issue #24).

Loads the five scenario audios from data/audio/manifest.json, honors the
clean/radio selection per run, and releases `audio.received` events in scenario
order (scenario_timestamp, scaled by a speed factor). Transcription runs
concurrently downstream — this service never waits for it.

A missing/unreadable file emits a labeled `error` event and ingestion
continues: audio problems must never crash a run.
"""

from __future__ import annotations

import asyncio
import json
import wave
from pathlib import Path
from typing import Optional

from backend.api.config import REPO_ROOT

MANIFEST_PATH = REPO_ROOT / "data" / "audio" / "manifest.json"


class AudioIngestionService:
    def __init__(self, manifest_path: Path = MANIFEST_PATH) -> None:
        self.manifest_path = manifest_path

    def load_manifest(self) -> list[dict]:
        """Manifest items sorted by scenario timestamp (scenario order)."""
        with self.manifest_path.open() as f:
            items = json.load(f)
        return sorted(items, key=lambda i: i["scenario_timestamp"])

    def resolve_path(self, item: dict, variant: str) -> Path:
        if variant not in ("clean", "radio"):
            raise ValueError(f"unknown audio variant {variant!r}")
        return REPO_ROOT / item[f"{variant}_path"]

    @staticmethod
    def _duration_seconds(path: Path) -> Optional[float]:
        try:
            with wave.open(str(path)) as f:
                return round(f.getnframes() / f.getframerate(), 3)
        except Exception:
            return None

    async def ingest(
        self,
        bus,
        variant: str = "radio",
        speed_factor: float = 10.0,
    ) -> dict:
        """Emit audio.received for every manifest item, in scenario order.

        speed_factor divides the scenario_timestamp gaps (0 = no pacing).
        Returns counts: {"emitted": n, "errors": n}.
        """
        emitted = errors = 0
        previous_ts = 0
        for item in self.load_manifest():
            gap = item["scenario_timestamp"] - previous_ts
            previous_ts = item["scenario_timestamp"]
            if gap and speed_factor > 0:
                await asyncio.sleep(gap / speed_factor)

            path = self.resolve_path(item, variant)
            if not path.is_file():
                errors += 1
                await bus.publish(
                    "error",
                    {
                        "error_type": "audio_missing",
                        "component": "audio_ingestion",
                        "audio_id": item["audio_id"],
                        "audio_variant": variant,
                        "audio_path": str(path.relative_to(REPO_ROOT)),
                        "message": f"audio file missing for {item['audio_id']}",
                        "recoverable": True,
                    },
                )
                continue

            emitted += 1
            await bus.publish(
                "audio.received",
                {
                    "audio_id": item["audio_id"],
                    "scenario_timestamp": item["scenario_timestamp"],
                    "speaker_hint": item["speaker_hint"],
                    "audio_path": str(path.relative_to(REPO_ROOT)),
                    "audio_variant": variant,
                    "duration_seconds": self._duration_seconds(path),
                },
            )
        return {"emitted": emitted, "errors": errors}
