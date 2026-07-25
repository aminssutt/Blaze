"""In-memory event bus: monotonic sequences, history kept for SSE reconnection."""

import asyncio
import uuid
from datetime import datetime, timezone


class EventBus:
    def __init__(self, incident_id: str) -> None:
        self.incident_id = incident_id
        self.history: list[dict] = []
        self._subscribers: set[asyncio.Queue] = set()
        self._sequence = 0
        self._lock = asyncio.Lock()

    @property
    def last_sequence(self) -> int:
        return self._sequence

    async def publish(self, event_type: str, payload: dict) -> dict:
        """Build an envelope with the next sequence and broadcast it."""
        async with self._lock:
            self._sequence += 1
            envelope = {
                "event_id": f"evt-{uuid.uuid4().hex[:12]}",
                "incident_id": self.incident_id,
                "event_type": event_type,
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "sequence": self._sequence,
                "payload": payload,
            }
            self._broadcast(envelope)
        return envelope

    async def publish_envelope(self, envelope: dict) -> None:
        """Broadcast a pre-built envelope (mock replay). Sequence must stay monotonic."""
        async with self._lock:
            seq = envelope["sequence"]
            if seq <= self._sequence:
                raise ValueError(
                    f"non-monotonic sequence {seq} (last was {self._sequence})"
                )
            self._sequence = seq
            self._broadcast(envelope)

    def _broadcast(self, envelope: dict) -> None:
        self.history.append(envelope)
        for queue in self._subscribers:
            queue.put_nowait(envelope)

    async def subscribe(self, after_sequence: int = 0):
        """Yield history after `after_sequence`, then live events, without duplicates."""
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(queue)
        try:
            last_sent = after_sequence
            # History snapshot is taken after registering the queue, so anything
            # published in between shows up in both — the last_sent guard dedupes.
            for envelope in list(self.history):
                if envelope["sequence"] > last_sent:
                    last_sent = envelope["sequence"]
                    yield envelope
            while True:
                envelope = await queue.get()
                if envelope["sequence"] > last_sent:
                    last_sent = envelope["sequence"]
                    yield envelope
        finally:
            self._subscribers.discard(queue)

    async def reset(self) -> None:
        """Back to a blank state: history cleared, sequence restarts at 1."""
        async with self._lock:
            self.history.clear()
            self._sequence = 0
