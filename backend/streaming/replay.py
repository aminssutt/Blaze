"""Dev-mode replay of the frozen mock stream (contracts/mocks/demo_event_stream.jsonl).

Lets the frontend integrate against real SSE before the orchestrator exists.
"""

import asyncio
import json
from datetime import datetime

from backend.api.config import REPO_ROOT
from backend.streaming.bus import EventBus

MOCK_STREAM_PATH = REPO_ROOT / "contracts" / "mocks" / "demo_event_stream.jsonl"


def load_mock_envelopes() -> list[dict]:
    with MOCK_STREAM_PATH.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def _mock_delays(envelopes: list[dict]) -> list[float]:
    """Inter-event delays from the mock timestamps, so pacing looks realistic."""
    times = [
        datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")) for e in envelopes
    ]
    return [0.0] + [
        max(0.0, (b - a).total_seconds()) for a, b in zip(times, times[1:])
    ]


async def replay_mock_stream(bus: EventBus, speed_factor: float = 10.0) -> int:
    """Publish the whole mock stream through the bus.

    speed_factor divides the original inter-event gaps (10 = 10x faster).
    Returns the number of events published.
    """
    envelopes = load_mock_envelopes()
    delays = _mock_delays(envelopes)
    for envelope, delay in zip(envelopes, delays):
        if delay and speed_factor > 0:
            await asyncio.sleep(delay / speed_factor)
        await bus.publish_envelope(envelope)
    return len(envelopes)
