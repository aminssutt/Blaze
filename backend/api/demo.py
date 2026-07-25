"""Demo controller — deterministic start/reset of the scenario run.

Until the real orchestrator lands (Phase 2), a "run" re-emits the frozen mock
stream through the EventBus with fresh sequences/timestamps, reflecting the
current clean/radio and online/offline selections. Reset always returns the
system to IDLE with the sequence restarting at 1.
"""

import asyncio
import contextlib
import os
from enum import StrEnum

from backend.streaming.bus import EventBus
from backend.streaming.replay import load_mock_envelopes, _mock_delays


class DemoState(StrEnum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"


class DemoController:
    def __init__(self, bus: EventBus) -> None:
        self.bus = bus
        self.state = DemoState.IDLE
        self.audio_variant = "radio"  # radio | clean
        self.network_mode = "online"  # online | offline
        self._run_task: asyncio.Task | None = None

    # -- scenario control ---------------------------------------------------

    async def start(self, speed_factor: float = 10.0) -> None:
        if self.state is DemoState.RUNNING:
            raise RuntimeError("scenario already running")
        self.state = DemoState.RUNNING
        self._run_task = asyncio.create_task(self._run(speed_factor))

    async def reset(self) -> None:
        """Deterministic return to IDLE: cancel any run, sequence restarts at 1."""
        if self._run_task is not None:
            self._run_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._run_task
            self._run_task = None
        await self.bus.reset()
        self.state = DemoState.IDLE

    async def set_network_mode(self, mode: str) -> None:
        previous, self.network_mode = self.network_mode, mode
        # Propagate to the process env: every tool adapter (weather, elevation,
        # firms, osm) resolves its live/cached mode from NETWORK_MODE at call
        # time, so flipping offline immediately forces cache everywhere.
        os.environ["NETWORK_MODE"] = mode
        if self.state is DemoState.RUNNING and previous != mode:
            await self.bus.publish(
                "network.mode.changed",
                {"previous_mode": previous, "network_mode": mode},
            )

    def status(self) -> dict:
        return {
            "state": self.state.value,
            "last_sequence": self.bus.last_sequence,
            "audio_variant": self.audio_variant,
            "network_mode": self.network_mode,
            "incident_id": self.bus.incident_id,
        }

    # -- run loop -----------------------------------------------------------

    def _adapt_payload(self, event_type: str, payload: dict) -> dict:
        """Reflect current toggles in the emitted events."""
        payload = dict(payload)
        if event_type == "incident.started":
            payload["network_mode"] = self.network_mode
            payload["audio_mode"] = self.audio_variant
        if event_type == "audio.received":
            payload["audio_variant"] = self.audio_variant
            if "audio_path" in payload:
                for variant in ("_radio.wav", "_clean.wav"):
                    payload["audio_path"] = payload["audio_path"].replace(
                        variant, f"_{self.audio_variant}.wav"
                    )
        return payload

    async def _run(self, speed_factor: float) -> None:
        """Re-emit the mock scenario with fresh sequences/ids/timestamps."""
        envelopes = load_mock_envelopes()
        delays = _mock_delays(envelopes)
        for envelope, delay in zip(envelopes, delays):
            if delay and speed_factor > 0:
                await asyncio.sleep(delay / speed_factor)
            await self.bus.publish(
                envelope["event_type"],
                self._adapt_payload(envelope["event_type"], envelope["payload"]),
            )
        self.state = DemoState.COMPLETED
